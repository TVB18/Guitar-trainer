// Run with: node --test tests/*.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { trainer, code } = require('./helpers/trainer.cjs');

for (const sampleRate of [44100, 48000]) {
  for (const duration of [1000 / 15, 1000 / 12, 100, 150, 250]) {
    test(`full scale at ${duration} ms/note, ${sampleRate} Hz, without silence`, () => {
      const app = trainer(sampleRate);
      const sequence = Array.from(app.read('exercise.notes.map(n => n.midi)'));
      for (const midi of sequence) app.play(midi, duration);
      assert.equal(app.read('playedPitches.size'), app.read('exercise.pitches.size'));
    });
  }
  test(`all six open strings retain their octaves at ${sampleRate} Hz`, () => {
    for (const [midi, name, octave] of [[40,'E',2],[45,'A',2],[50,'D',3],[55,'G',3],[59,'B',3],[64,'E',4]]) {
      const app = trainer(sampleRate);
      app.play(midi, 300);
      assert.equal(app.nodes.note.textContent, name);
      assert.equal(app.nodes.octave.textContent, `Octave ${octave}`);
    }
  });
  test(`low-note transitions are accepted within 50 ms at ${sampleRate} Hz`, () => {
    const app = trainer(sampleRate);
    for (const midi of [45, 48, 50, 52]) app.play(midi, 150);
    assert.equal(app.advances.length, 4);
    for (const [index, advance] of app.advances.entries()) {
      assert.ok(advance.time - index * 150 <= 50.001, `note ${index + 1}: ${advance.time - index * 150} ms`);
    }
  });
  test(`fast scale with noisy attacks at ${sampleRate} Hz`, () => {
    const app = trainer(sampleRate, code, 0.15);
    for (const midi of Array.from(app.read('exercise.notes.map(n => n.midi)'))) app.play(midi, 1000 / 12);
    assert.equal(app.read('playedPitches.size'), app.read('exercise.pitches.size'));
  });
}

test('wrong octave and a single transient estimate cannot advance', () => {
  const app = trainer();
  app.play(57, 200);
  assert.equal(app.read('playedPitches.size'), 0);
  app.read('detectPitch = () => 110; exerciseMatches = 0; previousExerciseNote = null;');
  app.play(45, 1000 / 60);
  assert.equal(app.read('playedPitches.size'), 0);
});

test('the listener shows short notes, wrong exercise notes and their tuning', () => {
  const app = trainer();
  for (const [midi,name,octave] of [[45,'A',2],[48,'C',3],[54,'F♯',3],[57,'A',3]]) {
    app.play(midi,100);
    assert.equal(app.nodes.note.textContent,name);
    assert.equal(app.nodes.octave.textContent,`Octave ${octave}`);
    assert.match(app.nodes.frequency.textContent,/\d+\.\d Hz/);
    assert.match(app.nodes.cents.textContent,/^-?\+?\d+ cents$/);
    assert.equal(app.nodes.needle.hidden,false);
  }
});

test('listener keeps the last pitch briefly, then clears after silence and Stop', async () => {
  const app = trainer();
  app.play(45,100);
  app.play(null,300);
  assert.equal(app.nodes.note.textContent,'A');
  app.play(null,1000);
  assert.equal(app.nodes.note.textContent,'—');
  assert.equal(app.nodes.needle.hidden,true);
  app.play(45,150);
  await app.read('stopListening()');
  assert.equal(app.nodes.note.textContent,'—');
  assert.equal(app.nodes.octave.textContent,'Waiting for a note');
});

test('sustained notes, restart, silence release and pause', () => {
  const app = trainer();
  app.play(45, 1000);
  assert.equal(app.read('playedPitches.size'), 1);
  app.nodes['restart-exercise'].handlers.click();
  app.play(45, 300);
  assert.equal(app.read('playedPitches.size'), 0);
  app.play(null, 300);
  app.play(45, 150);
  assert.equal(app.read('playedPitches.size'), 1);
  app.read('listening = false');
  app.play(48, 200);
  assert.equal(app.read('playedPitches.size'), 1);
  app.read('listening = true');
  app.play(48, 150);
  assert.equal(app.read('playedPitches.size'), 2);
});
