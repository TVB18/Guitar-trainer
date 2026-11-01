const test = require('node:test');
const assert = require('node:assert/strict');
const { trainer, code } = require('./helpers/trainer.cjs');

function scaleRun(length) {
  const app = trainer();
  app.read('let testClock = 1000; Date.now = () => testClock;');
  app.nodes['exercise-run-length'].value = String(length);
  app.nodes['exercise-run-length'].handlers.change();
  return app;
}

function completeExercise(app) {
  const start = app.read('startingRoot.midi');
  for (const midi of [start, ...Array.from(app.read('[...exercise.pitches]')).filter(midi => midi !== start)]) {
    app.read(`heldNote = null; handleExerciseNote(${midi})`);
  }
}

test('a run counts finished exercises and ends with a run-complete frame', () => {
  const app = scaleRun(2);
  const status = () => app.nodes['exercise-run-status'].textContent;
  assert.equal(app.nodes['exercise-run-controls'].hidden, false);
  assert.match(status(), /^Exercise 1 \/ 2 · Time: 0\.0 s · Mistakes: 0$/);
  app.read('testClock += 2000');
  completeExercise(app);
  assert.match(app.nodes['exercise-result'].className, /feedback-complete/);
  assert.match(app.nodes['exercise-feedback'].textContent, /^✓ Well done! .*Choose New exercise/);
  assert.equal(status(), 'Exercise 1 / 2 · Time: 2.0 s · Mistakes: 0');
  // The clock waits while the finished exercise is shown.
  app.read('testClock += 5000; updateRunTime()');
  assert.match(status(), /Time: 2\.0 s/);
  assert.equal(app.nodes['new-exercise'].textContent, 'New exercise');
  app.nodes['new-exercise'].handlers.click();
  assert.match(status(), /^Exercise 2 \/ 2/);
  app.read('testClock += 1000');
  completeExercise(app);
  assert.match(app.nodes['exercise-result'].className, /feedback-run-complete/);
  assert.match(app.nodes['exercise-feedback'].textContent, /Run complete! 2 exercises in 3\.0 s with 0 mistakes/);
  assert.match(status(), /^Run complete: 2 \/ 2 · Finished in 3\.0 s · Average: 1\.5 s\/exercise/);
  assert.equal(app.nodes['new-exercise'].textContent, 'New run');
  app.nodes['new-exercise'].handlers.click();
  assert.equal(status(), 'Exercise 1 / 2 · Time: 0.0 s · Mistakes: 0');
  assert.equal(app.nodes['new-exercise'].textContent, 'New exercise');
});

test('wrong notes count as run mistakes only while the exercise is unfinished', () => {
  const app = scaleRun(3);
  app.read('handleExerciseNote(48)');
  app.read('handleExerciseNote(45); handleExerciseNote(54)');
  assert.equal(app.read('runMistakes'), 2);
  completeExercise(app);
  app.read('heldNote = null; handleExerciseNote(54)');
  assert.match(app.nodes['exercise-result'].className, /feedback-error/);
  assert.equal(app.read('runMistakes'), 2);
  assert.match(app.nodes['exercise-run-status'].textContent, /Mistakes: 2$/);
});

test('continue automatically shows the next exercise after a 3 second countdown', () => {
  const app = scaleRun(2);
  app.nodes['auto-continue'].checked = true;
  app.nodes['auto-continue'].handlers.change();
  const first = app.read('exercise.root + exercise.startingString + exercise.side + exercise.type');
  completeExercise(app);
  assert.match(app.nodes['exercise-feedback'].textContent, /Well done! .*Next exercise in 3…$/);
  assert.match(app.nodes['exercise-result'].className, /feedback-complete/);
  // Notes during the countdown leave the finished frame alone.
  app.read('heldNote = null; handleExerciseNote(54)');
  assert.match(app.nodes['exercise-result'].className, /feedback-complete/);
  assert.equal(app.read('runMistakes'), 0);
  app.advanceTimers(1000);
  assert.match(app.nodes['exercise-feedback'].textContent, /Next exercise in 2…$/);
  app.advanceTimers(2000);
  assert.notEqual(app.read('exercise.root + exercise.startingString + exercise.side + exercise.type'), first);
  assert.equal(app.read('playedPitches.size'), 0);
  assert.match(app.nodes['exercise-run-status'].textContent, /^Exercise 2 \/ 2/);
  // The last exercise ends the run; nothing follows automatically.
  completeExercise(app);
  assert.match(app.nodes['exercise-result'].className, /feedback-run-complete/);
  app.advanceTimers(10000);
  assert.match(app.nodes['exercise-result'].className, /feedback-run-complete/);
});

test('unticking, restarting or changing mode cancels the countdown', () => {
  const app = scaleRun(5);
  app.nodes['auto-continue'].checked = true;
  app.nodes['auto-continue'].handlers.change();
  completeExercise(app);
  app.nodes['auto-continue'].checked = false;
  app.nodes['auto-continue'].handlers.change();
  app.advanceTimers(5000);
  assert.equal(app.read('exerciseComplete()'), true);
  app.nodes['auto-continue'].checked = true;
  app.nodes['auto-continue'].handlers.change();
  app.nodes['restart-exercise'].handlers.click();
  completeExercise(app);
  app.nodes['training-mode'].value = 'root-first';
  app.nodes['training-mode'].handlers.change();
  app.advanceTimers(5000);
  assert.equal(app.read('rootStarted'), false);
  assert.equal(app.read('runCount'), 0);
});

test('in the recognition modes the next run starts automatically', () => {
  const app = trainer();
  app.read('let testClock = 1000; Date.now = () => testClock;');
  app.nodes['run-length'].value = '1';
  app.nodes['training-mode'].value = 'recognition-visual';
  app.nodes['training-mode'].handlers.change();
  assert.equal(app.nodes['exercise-run-controls'].hidden, true);
  app.nodes['auto-continue'].checked = true;
  app.nodes['auto-continue'].handlers.change();
  app.nodes['new-exercise'].handlers.click();
  app.read('handleExerciseNote(recognitionTarget.midi)');
  assert.match(app.nodes['exercise-result'].className, /feedback-run-complete/);
  assert.match(app.nodes['exercise-feedback'].textContent, /^Run complete in .* Next run in 3…$/);
  app.advanceTimers(3000);
  assert.equal(app.read('runActive'), true);
  assert.equal(app.read('runCount'), 0);
});

test('the pause slider sets the countdown length', () => {
  const app = scaleRun(3);
  app.nodes['auto-continue'].checked = true;
  app.nodes['auto-continue'].handlers.change();
  app.nodes['next-delay'].value = '6';
  app.nodes['next-delay'].handlers.input();
  assert.equal(app.nodes['next-delay-value'].textContent, '6 s');
  completeExercise(app);
  assert.match(app.nodes['exercise-feedback'].textContent, /Next exercise in 6…$/);
  app.advanceTimers(5000);
  assert.equal(app.read('exerciseComplete()'), true);
  app.advanceTimers(1000);
  assert.equal(app.read('playedPitches.size'), 0);
  app.nodes['next-delay'].value = '40';
  app.nodes['next-delay'].handlers.input();
  assert.equal(app.read('nextExerciseDelay'), 10);
});

test('exercises per run and continue automatically are remembered', () => {
  const storage = 'var testStore = {};\nvar localStorage = { getItem: key => testStore[key] ?? null, setItem: (key, value) => { testStore[key] = value; } };\n';
  const app = trainer(48000, storage + code);
  app.nodes['exercise-run-length'].value = '4';
  app.nodes['exercise-run-length'].handlers.change();
  app.nodes['auto-continue'].checked = true;
  app.nodes['auto-continue'].handlers.change();
  app.nodes['next-delay'].value = '5';
  app.nodes['next-delay'].handlers.input();
  app.nodes['next-delay'].handlers.change();
  const saved = JSON.parse(app.read('testStore["guitar-trainer-settings"]'));
  assert.equal(saved.exerciseRunLength, 4);
  assert.equal(saved.autoContinue, true);
  assert.equal(saved.nextDelay, 5);
  const next = trainer(48000, storage.replace('{}', JSON.stringify({ 'guitar-trainer-settings': JSON.stringify(saved) })) + code);
  assert.equal(next.read('runLength'), 4);
  assert.equal(next.read('autoContinue'), true);
  assert.equal(next.nodes['auto-continue'].checked, true);
  assert.equal(next.read('nextExerciseDelay'), 5);
  assert.equal(next.nodes['next-delay-value'].textContent, '5 s');
});
