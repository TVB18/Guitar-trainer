const test = require('node:test');
const assert = require('node:assert/strict');
const { trainer } = require('./helpers/trainer.cjs');

function setup() {
  const app = trainer();
  app.read(`
    listening = false;
    let requestedAudio, stopped = 0, deviceChange;
    const inputDevices = [
      { kind: 'audioinput', deviceId: 'focusrite', label: 'Focusrite USB' },
      { kind: 'audioinput', deviceId: 'hx', label: 'HX Stomp <USB>' },
      { kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' },
      { kind: 'videoinput', deviceId: 'camera', label: 'Camera' }
    ];
    navigator.mediaDevices = {
      async enumerateDevices() { return inputDevices; },
      async getUserMedia(constraints) {
        requestedAudio = constraints.audio;
        const label = inputDevices.find(device => device.deviceId === constraints.audio.deviceId?.exact)?.label || 'Focusrite USB';
        const track = { label, stop() { stopped++; }, addEventListener() {} };
        return { getTracks() { return [track]; }, getAudioTracks() { return [track]; } };
      }
    };
    AudioContext = class {
      constructor() { this.state = 'running'; }
      async resume() {}
      async close() { this.state = 'closed'; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() { return { fftSize: 2048 }; }
    };
  `);
  return app;
}

test('input list excludes outputs and cameras, escapes labels and retains selection', async () => {
  const app = setup();
  app.nodes['audio-input'].value = 'hx';
  await app.read('refreshAudioInputs()');
  assert.match(app.nodes['audio-input'].innerHTML, /HX Stomp &lt;USB&gt;/);
  assert.doesNotMatch(app.nodes['audio-input'].innerHTML, /Speakers|Camera/);
  assert.equal(app.nodes['audio-input'].value, 'hx');
  assert.match(app.nodes['audio-input-status'].textContent, /Selected: HX Stomp/);
});

test('explicit input is requested, actual device shown, stop permits switching without lost progress', async () => {
  const app = setup();
  await app.read('refreshAudioInputs()');
  app.nodes['audio-input'].value = 'focusrite';
  await app.nodes.start.handlers.click();
  assert.equal(app.read('requestedAudio.deviceId.exact'), 'focusrite');
  assert.equal(app.read('requestedAudio.echoCancellation'), false);
  assert.match(app.nodes['audio-input-status'].textContent, /Using: Focusrite USB/);
  assert.equal(app.nodes['audio-input'].disabled, true);
  app.read('handleExerciseNote(45)');
  await app.nodes.start.handlers.click();
  assert.equal(app.nodes['audio-input'].disabled, false);
  assert.equal(app.read('stopped'), 1);
  app.nodes['audio-input'].value = 'hx';
  app.nodes['audio-input'].handlers.change();
  await app.nodes.start.handlers.click();
  assert.equal(app.read('requestedAudio.deviceId.exact'), 'hx');
  assert.match(app.nodes['audio-input-status'].textContent, /Using: HX Stomp/);
  assert.equal(app.read('playedPitches.size'), 1);
  await app.nodes.start.handlers.click();
});

test('browser default omits exact constraint and still shows actual input', async () => {
  const app = setup();
  await app.nodes.start.handlers.click();
  assert.equal(app.read('requestedAudio.deviceId'), undefined);
  assert.match(app.nodes['audio-input-status'].textContent, /Using: Focusrite USB/);
  await app.nodes.start.handlers.click();
});

test('removed selection remains explicit and an unavailable input reports a recoverable error', async () => {
  const app = setup();
  app.nodes['audio-input'].value = 'missing';
  await app.read('refreshAudioInputs()');
  assert.equal(app.nodes['audio-input'].value, 'missing');
  assert.match(app.nodes['audio-input'].innerHTML, /unavailable/);
  app.read(`navigator.mediaDevices.getUserMedia = async () => { const error = new Error('missing'); error.name = 'OverconstrainedError'; throw error; };`);
  await app.nodes.start.handlers.click();
  assert.match(app.nodes.message.textContent, /select another input/);
  assert.equal(app.nodes.start.disabled, false);
  assert.equal(app.nodes['audio-input'].disabled, false);
});

test('unnamed devices have readable placeholders and enumeration failure does not block capture', async () => {
  const app = setup();
  app.read("inputDevices[0].label = ''");
  await app.read('refreshAudioInputs()');
  assert.match(app.nodes['audio-input'].innerHTML, /Audio input 1/);
  app.read("navigator.mediaDevices.enumerateDevices = async () => { throw new Error('permission'); }");
  await app.read('refreshAudioInputs()');
  assert.match(app.nodes['audio-input-status'].textContent, /request access/);
  await app.nodes.start.handlers.click();
  assert.equal(app.read('listening'), true);
  await app.nodes.start.handlers.click();
});
