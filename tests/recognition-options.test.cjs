const test = require('node:test');
const assert = require('node:assert/strict');
const { trainer, code } = require('./helpers/trainer.cjs');

function recognition() {
  const app = trainer();
  app.nodes['training-mode'].value = 'recognition-visual';
  app.nodes['training-mode'].handlers.change();
  app.nodes['new-exercise'].handlers.click();
  return app;
}

test('all notes includes all twelve pitch classes, stays below fret 16 and resets the run', () => {
  const app = recognition();
  app.read('handleExerciseNote(recognitionTarget.midi)');
  app.nodes['recognition-notes'].value = 'all';
  app.nodes['recognition-notes'].handlers.change();
  assert.equal(app.read('runCount'), 0);
  assert.equal(app.read('recognitionNotes'), 'all');
  assert.equal(app.read('new Set(allRecognitionTargets.map(target => target.midi % 12)).size'), 12);
  assert.equal(app.read('allRecognitionTargets.every(target => target.fret <= 15)'), true);
  app.read('recognitionTarget = allRecognitionTargets.find(target => target.midi % 12 === 1); renderExercise()');
  assert.equal(app.nodes['expected-note'].textContent, 'C♯ / D♭');
  app.nodes['new-exercise'].handlers.click();
  app.read('heldNote = null; handleExerciseNote(recognitionTarget.midi)');
  assert.equal(app.read('runCount'), 1);
  app.nodes['recognition-notes'].value = 'natural';
  app.nodes['recognition-notes'].handlers.change();
  assert.equal(app.read('Object.values(GuitarScales.naturals).includes(recognitionTarget.midi % 12)'), true);
  app.nodes['training-mode'].value = 'full';
  app.nodes['training-mode'].handlers.change();
  assert.equal(app.nodes['recognition-controls'].hidden, true);
  // Scale modes use the fretboard layout instead of the low/high hint.
  assert.equal(app.nodes['note-region'].hidden, true);
  assert.equal(app.nodes['recognition-board'].hidden, false);
});

test('string labels and style switch work without resetting an active run', () => {
  const app = recognition();
  assert.equal(app.read('stringLabel(GuitarScales.strings.find(row => row.string === 2))'), 'B-string (2)');
  const attributes = {};
  app.read('document.documentElement = {}');
  app.read('document.documentElement').setAttribute = (key, value) => { attributes[key] = value; };
  app.read('handleExerciseNote(recognitionTarget.midi)');
  const target = app.read('recognitionTarget.midi');
  app.nodes.theme.value = 'neon';
  app.nodes.theme.handlers.change();
  assert.equal(attributes['data-theme'], 'neon');
  assert.equal(app.read('runCount'), 1);
  assert.equal(app.read('recognitionTarget.midi'), target);
  app.nodes.theme.value = 'classic';
  app.nodes.theme.handlers.change();
  assert.equal(attributes['data-theme'], 'classic');
});

test('saved settings are restored and changes are saved again', () => {
  const store = { 'guitar-trainer-settings': JSON.stringify({ theme: 'neon', trainingMode: 'recognition', runLength: 7, recognitionNotes: 'all', strings: [2, 3] }) };
  const app = trainer(48000, `var testStore = ${JSON.stringify(store)};
var localStorage = { getItem: key => testStore[key] ?? null, setItem: (key, value) => { testStore[key] = value; } };
document.documentElement = { setAttribute(key, value) { this[key] = value; } };
` + code);
  assert.equal(app.read('document.documentElement["data-theme"]'), 'neon');
  assert.equal(app.nodes.theme.value, 'neon');
  // The removed plain recognition mode opens as the visual mode.
  assert.equal(app.read('trainingMode'), 'recognition-visual');
  assert.equal(app.nodes['training-mode'].value, 'recognition-visual');
  assert.equal(app.read('runLength'), 7);
  assert.equal(app.read('recognitionNotes'), 'all');
  assert.equal(app.read('JSON.stringify([...recognitionStrings].sort())'), '[2,3]');
  assert.equal(app.nodes['train-string-6'].checked, false);
  assert.equal(app.nodes['train-string-2'].checked, true);
  app.nodes['train-string-6'].checked = true;
  app.nodes['train-string-6'].handlers.change();
  assert.deepEqual(JSON.parse(app.read('testStore["guitar-trainer-settings"]')),
    { theme: 'neon', trainingMode: 'recognition-visual', runLength: 7, exerciseRunLength: 10, autoContinue: false, nextDelay: 3, clickTypes: ['name'], triadTypes: ['spell'], recognitionNotes: 'all', frameFrets: 4, frameStrings: 3, practiceSet: 'all', timeLimit: 0, strings: [2, 3, 6] });
});

test('broken or blocked storage falls back to the defaults', () => {
  for (const storage of ['var localStorage = { getItem: () => "{not json", setItem() { throw new Error("full"); } };', '']) {
    const app = trainer(48000, storage + '\n' + code);
    assert.equal(app.read('trainingMode'), 'full');
    assert.equal(app.read('recognitionStrings.size'), 6);
    app.nodes['training-mode'].value = 'recognition-visual';
    app.nodes['training-mode'].handlers.change();
    assert.equal(app.read('trainingMode'), 'recognition-visual');
  }
});

function visual() {
  const app = trainer();
  app.nodes['training-mode'].value = 'recognition-visual';
  app.nodes['training-mode'].handlers.change();
  app.nodes['new-exercise'].handlers.click();
  return app;
}

test('visual recognition frames every target at a random spot without the low/high hint', () => {
  const app = visual();
  assert.equal(app.read('trainingMode'), 'recognition-visual');
  assert.equal(app.nodes['exercise-title'].textContent, 'Fretboard recognition visual');
  assert.equal(app.nodes['note-region'].hidden, true);
  assert.equal(app.nodes['recognition-board'].hidden, false);
  assert.equal(app.nodes['frame-controls'].hidden, false);
  assert.match(app.nodes['board-scroll'].innerHTML, /<svg[^>]*>.*class="board-frame"/);
  assert.doesNotMatch(app.nodes['board-scroll'].innerHTML, /board-target/);
  const offsets = new Set();
  for (let i = 0; i < 300; i++) {
    app.nodes['new-exercise'].handlers.click();
    const [target, frame] = JSON.parse(app.read('JSON.stringify([recognitionTarget, recognitionFrame])'));
    assert.equal(frame.toFret - frame.fromFret, 3);
    assert.equal(frame.toString - frame.fromString, 2);
    assert.ok(frame.fromFret >= 0 && frame.toFret <= 15 && frame.fromString >= 1 && frame.toString <= 6);
    assert.ok(target.fret >= frame.fromFret && target.fret <= frame.toFret);
    assert.ok(target.string >= frame.fromString && target.string <= frame.toString);
    offsets.add(target.fret - frame.fromFret);
  }
  assert.equal(offsets.size, 4);
});

test('frame size is bounded, saved, and changing it keeps the run going', () => {
  const app = trainer(48000, `var testStore = {};
var localStorage = { getItem: key => testStore[key] ?? null, setItem: (key, value) => { testStore[key] = value; } };
` + code);
  app.read('let testClock = 1000; Date.now = () => testClock;');
  app.nodes['training-mode'].value = 'recognition-visual';
  app.nodes['training-mode'].handlers.change();
  app.read('listening = true');
  app.nodes['new-exercise'].handlers.click();
  app.read('handleExerciseNote(recognitionTarget.midi)');
  const target = app.read('recognitionTarget.midi');
  app.nodes['frame-frets'].value = '40';
  app.nodes['frame-frets'].handlers.change();
  app.nodes['frame-strings'].value = '0';
  app.nodes['frame-strings'].handlers.change();
  assert.equal(app.nodes['frame-frets'].value, '16');
  assert.equal(app.nodes['frame-strings'].value, '1');
  assert.equal(app.read('JSON.stringify(recognitionFrame)'), JSON.stringify({ fromFret: 0, toFret: 15, fromString: app.read('recognitionTarget.string'), toString: app.read('recognitionTarget.string') }));
  assert.equal(app.read('runCount'), 1);
  assert.equal(app.read('recognitionTarget.midi'), target);
  const saved = JSON.parse(app.read('testStore["guitar-trainer-settings"]'));
  assert.equal(saved.trainingMode, 'recognition-visual');
  assert.equal(saved.frameFrets, 16);
  assert.equal(saved.frameStrings, 1);
});

test('the requested string is coloured and the note label sits level with it', () => {
  const app = visual();
  app.nodes['recognition-notes'].value = 'all';
  app.nodes['recognition-notes'].handlers.change();
  for (let i = 0; i < 30; i++) {
    app.nodes['new-exercise'].handlers.click();
    const string = app.read('recognitionTarget.string');
    const html = app.nodes['board-scroll'].innerHTML;
    assert.equal((html.match(/board-requested"/g) || []).length, 1);
    const y = Number(html.match(/class="board-string board-requested"[^>]*y1="([\d.]+)"/)[1]);
    assert.equal(y, 20 + (string - 1) * 30);
    assert.equal(app.nodes['board-note'].textContent, app.read('pitchLabel(recognitionTarget.midi)').replace(' / ', '\n'));
    assert.equal(app.nodes['board-note'].style.top, `${(y / 210 * 100).toFixed(2)}%`);
  }
  app.read('recognitionTarget = { ...recognitionTarget, midi: 66 }; drawRecognitionBoard()');
  assert.equal(app.nodes['board-note'].textContent, 'F♯4\nG♭4');
});

test('mistakes count once per wrong pluck and reset with a new run', () => {
  const app = trainer();
  app.read('let testClock = 1000; Date.now = () => testClock;');
  app.nodes['run-length'].value = '2';
  app.nodes['training-mode'].value = 'recognition-visual';
  app.nodes['training-mode'].handlers.change();
  app.read('listening = true');
  app.nodes['new-exercise'].handlers.click();
  assert.equal(app.nodes['run-mistakes'].textContent, 'Mistakes: 0');
  const wrong = app.read('recognitionTarget.midi + 1');
  app.read(`handleExerciseNote(${wrong}); handleExerciseNote(${wrong})`);
  assert.equal(app.read('runMistakes'), 1);
  app.read(`heldNote = null; handleExerciseNote(${wrong})`);
  assert.equal(app.nodes['run-mistakes'].textContent, 'Mistakes: 2');
  app.read('testClock += 2000; handleExerciseNote(recognitionTarget.midi); testClock += 1500; handleExerciseNote(recognitionTarget.midi)');
  assert.equal(app.nodes['exercise-feedback'].textContent, 'Run complete in 3.5 s with 2 mistakes! Choose New run to try again.');
  app.read('handleExerciseNote(30)');
  assert.equal(app.read('runMistakes'), 2);
  app.nodes['new-exercise'].handlers.click();
  assert.equal(app.nodes['run-mistakes'].textContent, 'Mistakes: 0');
  app.read(`heldNote = null; handleExerciseNote(recognitionTarget.midi + 1)`);
  app.nodes['reset-clock'].handlers.click();
  assert.equal(app.nodes['run-mistakes'].textContent, 'Mistakes: 0');
});

test('stray pitches after a correct note or shorter than 120 ms are not mistakes', () => {
  const app = trainer();
  app.nodes['run-length'].value = '5';
  app.nodes['training-mode'].value = 'recognition-visual';
  app.nodes['training-mode'].handlers.change();
  app.read('listening = true');
  app.nodes['new-exercise'].handlers.click();
  app.read('handleExerciseNote(recognitionTarget.midi, 1000, 30)');
  assert.equal(app.read('runCount'), 1);
  const wrong = app.read('recognitionTarget.midi + 1');
  app.read(`handleExerciseNote(${wrong}, 1100, 300)`);
  app.read(`handleExerciseNote(${wrong}, 1390, 300)`);
  assert.equal(app.read('runMistakes'), 0);
  assert.doesNotMatch(app.nodes['exercise-result'].className, /feedback-error/);
  app.read(`handleExerciseNote(${wrong}, 1500, 50)`);
  assert.equal(app.read('runMistakes'), 0);
  app.read(`handleExerciseNote(${wrong}, 1570, 120)`);
  assert.equal(app.read('runMistakes'), 1);
  assert.match(app.nodes['exercise-result'].className, /feedback-error/);
  app.read(`handleExerciseNote(${wrong}, 1700, 250)`);
  assert.equal(app.read('runMistakes'), 1);
  app.read('handleExerciseNote(recognitionTarget.midi, 1800, 20)');
  assert.equal(app.read('runCount'), 2);
});

test('with simulated audio, a brief muting pitch is ignored and a real wrong note counts', () => {
  const app = trainer();
  app.nodes['run-length'].value = '5';
  app.nodes['training-mode'].value = 'recognition-visual';
  app.nodes['training-mode'].handlers.change();
  app.nodes['new-exercise'].handlers.click();
  const target = app.read('recognitionTarget.midi');
  const next = () => app.read('recognitionTarget.midi');
  app.play(target, 300);
  assert.equal(app.read('runCount'), 1);
  const stray = next() === target + 5 ? target + 7 : target + 5;
  app.play(stray, 80);
  app.play(null, 500);
  assert.equal(app.read('runMistakes'), 0);
  const wrong = next() === target + 2 ? target + 3 : target + 2;
  app.play(wrong, 400);
  assert.equal(app.read('runMistakes'), 1);
});
