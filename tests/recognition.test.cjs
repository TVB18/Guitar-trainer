const test = require('node:test');
const assert = require('node:assert/strict');
const { trainer } = require('./helpers/trainer.cjs');

function run(length = 10) {
  const app = trainer();
  app.read('let testClock = 1000; Date.now = () => testClock;');
  app.nodes['run-length'].value = String(length);
  app.nodes['training-mode'].value = 'recognition-visual';
  app.nodes['training-mode'].handlers.change();
  app.nodes['new-exercise'].handlers.click();
  return app;
}

test('recognition targets are natural notes on the requested string at frets 0–15', () => {
  const app = run();
  assert.equal(app.read('recognitionTargets.every(target => target.fret >= 0 && target.fret <= 15 && target.midi === target.open + target.fret && Object.values(GuitarScales.naturals).includes(target.midi % 12))'), true);
  assert.equal(app.read('recognitionTargets.some(target => target.fret === 15)'), true);
  for (let i = 0; i < 100; i++) {
    const oldPitch = app.read('recognitionTarget.midi');
    app.nodes['new-exercise'].handlers.click();
    assert.notEqual(app.read('recognitionTarget.midi'), oldPitch);
    assert.doesNotMatch(app.nodes['expected-position'].textContent, /Fret/);
    assert.equal(app.nodes['exercise-chord'].hidden, true);
    assert.equal(app.nodes['toggle-hint'].hidden, true);
  }
});

test('correct pitches advance immediately, wrong octaves fail and held pitches cannot advance twice', () => {
  const app = run(3);
  const pitch = app.read('recognitionTarget.midi');
  app.read(`handleExerciseNote(${pitch + 12})`);
  assert.equal(app.read('runCount'), 0);
  assert.match(app.nodes['exercise-result'].className, /feedback-error/);
  app.read(`handleExerciseNote(${pitch})`);
  assert.equal(app.read('runCount'), 1);
  assert.notEqual(app.read('recognitionTarget.midi'), pitch);
  app.read(`handleExerciseNote(${pitch})`);
  assert.equal(app.read('runCount'), 1);
  app.read('testClock += 1234; handleExerciseNote(recognitionTarget.midi); testClock += 1000; handleExerciseNote(recognitionTarget.midi)');
  assert.equal(app.read('runCount'), 3);
  assert.equal(app.nodes['exercise-title'].textContent, 'Run complete');
  assert.equal(app.nodes['run-time'].textContent, 'Finished in 2.2 s');
  assert.equal(app.nodes['run-average'].textContent, 'Average: 0.74 s/note');
  app.read('testClock += 10000; handleExerciseNote(40); updateRunTime()');
  assert.equal(app.nodes['run-time'].textContent, 'Finished in 2.2 s');
  assert.equal(app.read('runCount'), 3);
});

test('clock waits for listening, pauses, resumes and resets when length changes', async () => {
  const app = run();
  app.read('listening = false; restartRecognition(); testClock += 5000');
  assert.equal(app.read('runStartedAt'), null);
  app.read('listening = true; restartRecognition(true); testClock += 1500');
  await app.read('stopListening()');
  assert.equal(app.nodes['run-time'].textContent, 'Time: 1.5 s');
  app.read('testClock += 9000; listening = true; startRunClock(); testClock += 500; pauseRunClock(); updateRunTime()');
  assert.equal(app.nodes['run-time'].textContent, 'Time: 2.0 s');
  assert.equal(app.nodes['run-average'].textContent, 'Average: — s/note');
  app.nodes['run-length'].value = '5';
  app.nodes['run-length'].handlers.change();
  assert.equal(app.read('runLength'), 5);
  assert.equal(app.read('runCount'), 0);
  assert.equal(app.nodes['run-time'].textContent, 'Time: 0.0 s');
  assert.equal(app.nodes['run-average'].textContent, 'Average: — s/note');
});

test('invalid run length is bounded and switching modes cancels the timer', () => {
  const app = run(1000);
  assert.equal(app.read('runLength'), 100);
  app.nodes['run-length'].value = '-5';
  app.nodes['run-length'].handlers.change();
  assert.equal(app.read('runLength'), 1);
  app.nodes['training-mode'].value = 'full';
  app.nodes['training-mode'].handlers.change();
  // The recognition run stops; the scale mode starts its own run of exercises.
  assert.equal(app.read('runLength'), 10);
  assert.equal(app.read('runCount'), 0);
  assert.match(app.nodes['exercise-run-status'].textContent, /^Exercise 1 \/ 10 · Time: 0\.0 s/);
  assert.equal(app.nodes['recognition-controls'].hidden, true);
  assert.equal(app.nodes['toggle-hint'].hidden, false);
  assert.equal(app.nodes['exercise-chord'].hidden, false);
});

test('average uses notes found so far and wrong notes use recognition names', () => {
  const app = run(10);
  app.read('listening = true; restartRecognition(true); testClock += 3000; handleExerciseNote(recognitionTarget.midi); updateRunTime()');
  assert.equal(app.nodes['run-average'].textContent, 'Average: 3.00 s/note');
  app.read('heldNote = null; recognitionTarget = { ...recognitionTarget, midi: 57 }; handleExerciseNote(58)');
  assert.equal(app.nodes['played-note'].textContent, 'A♯3 / B♭3');
});
