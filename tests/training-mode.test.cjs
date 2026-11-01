const test = require('node:test');
const assert = require('node:assert/strict');
const { trainer } = require('./helpers/trainer.cjs');

function rootFirst(app) {
  app.nodes['training-mode'].value = 'root-first';
  app.nodes['training-mode'].handlers.change();
}

test('root-first hides scale, pattern frame, fret, chord and hints until the exact root octave', () => {
  const app = trainer();
  app.nodes['toggle-hint'].handlers.click();
  rootFirst(app);
  assert.equal(app.nodes['exercise-title'].textContent, 'Find A on string 6');
  for (const id of ['exercise-chord', 'scale-notes', 'exercise-hint']) {
    assert.equal(app.nodes[id].hidden, true, id);
  }
  // Step 1 colours the requested string and frames the area around the root,
  // with the root at a random spot in the frame; no pattern or notes yet.
  assert.equal(app.nodes['recognition-board'].hidden, false);
  assert.match(app.nodes['board-scroll'].innerHTML, /board-requested/);
  assert.match(app.nodes['board-scroll'].innerHTML, /The root is inside the frame/);
  assert.doesNotMatch(app.nodes['board-scroll'].innerHTML, /board-dot|pattern is inside/);
  const frame = JSON.parse(app.read('JSON.stringify(rootFrame)'));
  assert.ok(frame.fromFret <= 5 && frame.toFret >= 5 && frame.toFret - frame.fromFret === 3);
  assert.ok(frame.fromString <= 6 && frame.toString === 6 && frame.toString - frame.fromString === 2);
  assert.equal(app.nodes['board-note'].textContent, 'A2');
  assert.doesNotMatch(app.nodes['expected-position'].textContent, /Fret/);
  app.nodes['toggle-hint'].handlers.click();
  assert.equal(app.nodes['exercise-hint'].hidden, true);
  app.read('handleExerciseNote(57)');
  assert.equal(app.read('rootStarted'), false);
  assert.doesNotMatch(app.nodes['exercise-feedback'].textContent, /Fret/);
  assert.match(app.nodes['exercise-result'].className, /feedback-error/);
  app.read('handleExerciseNote(45)');
  assert.equal(app.read('rootStarted'), true);
  assert.equal(app.read('playedPitches.size'), 1);
  assert.equal(app.nodes['exercise-chord'].hidden, false);
  // The pattern frame replaces the Left/Right text once the root is found.
  assert.match(app.nodes['board-scroll'].innerHTML, /class="board-frame"/);
  assert.match(app.nodes['board-scroll'].innerHTML, /frets 5 to 8\./);
  assert.match(app.nodes['exercise-title'].textContent, /A minor pentatonic/);
  assert.equal(app.nodes['toggle-hint'].disabled, false);
  assert.match(app.nodes['exercise-feedback'].textContent, /Root found/);
  app.advanceTimers(4999);
  assert.equal(app.nodes['pattern-hint'].hidden, true);
  app.advanceTimers(1);
  assert.equal(app.nodes['pattern-hint'].textContent, 'Pattern 1');
  assert.equal(app.nodes['pattern-hint'].hidden, false);
});

test('new and restart assignments stay concealed, cancel hints and do not count a held root', () => {
  const app = trainer();
  rootFirst(app);
  app.read('handleExerciseNote(45)');
  app.nodes['restart-exercise'].handlers.click();
  app.advanceTimers(10000);
  assert.equal(app.nodes['pattern-hint'].hidden, true);
  assert.equal(app.nodes['exercise-chord'].hidden, true);
  assert.doesNotMatch(app.nodes['board-scroll'].innerHTML, /pattern is inside/);
  app.read('handleExerciseNote(45)');
  assert.equal(app.read('rootStarted'), false);
  app.read('heldNote = null; handleExerciseNote(45)');
  assert.equal(app.read('rootStarted'), true);
  app.nodes['new-exercise'].handlers.click();
  app.advanceTimers(10000);
  assert.equal(app.nodes['exercise-chord'].hidden, true);
  assert.doesNotMatch(app.nodes['board-scroll'].innerHTML, /pattern is inside/);
  assert.match(app.nodes['board-scroll'].innerHTML, /The root is inside the frame/);
  assert.equal(app.nodes['pattern-hint'].hidden, true);
  assert.equal(app.read('playedPitches.size'), 0);
});

test('full mode remains available and root-first preserves progress across Stop listening', async () => {
  const app = trainer();
  rootFirst(app);
  app.read('handleExerciseNote(45); handleExerciseNote(48)');
  await app.read('stopListening()');
  assert.equal(app.read('playedPitches.size'), 2);
  assert.equal(app.nodes['exercise-chord'].hidden, false);
  app.nodes['training-mode'].value = 'full';
  app.nodes['training-mode'].handlers.change();
  assert.equal(app.nodes['exercise-chord'].hidden, false);
  assert.match(app.nodes['board-scroll'].innerHTML, /class="board-frame"/);
  assert.equal(app.nodes['toggle-hint'].disabled, false);
  assert.equal(app.read('playedPitches.size'), 0);
  assert.match(app.nodes['expected-position'].textContent, /Fret 5/);
});
