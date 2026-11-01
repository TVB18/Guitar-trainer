const test = require('node:test');
const assert = require('node:assert/strict');
const { trainer } = require('./helpers/trainer.cjs');

test('single and combined string selections restrict every new recognition target', () => {
  const app = trainer();
  app.nodes['training-mode'].value = 'recognition-visual';
  app.nodes['training-mode'].handlers.change();
  for (const string of [1, 2, 3, 4, 6]) {
    app.nodes[`train-string-${string}`].checked = false;
    app.nodes[`train-string-${string}`].handlers.change();
  }
  for (let i = 0; i < 60; i++) {
    app.nodes['new-exercise'].handlers.click();
    assert.equal(app.read('recognitionTarget.string'), 5);
    assert.equal(app.nodes['requested-string'].textContent, 'A-string (5)');
  }
  app.nodes['train-string-5'].checked = false;
  app.nodes['train-string-5'].handlers.change();
  assert.equal(app.nodes['train-string-5'].checked, true);
  assert.equal(app.read('recognitionStrings.size'), 1);
  app.read('handleExerciseNote(recognitionTarget.midi)');
  app.nodes['train-string-2'].checked = true;
  app.nodes['train-string-2'].handlers.change();
  assert.equal(app.read('runCount'), 0);
  app.nodes['recognition-notes'].value = 'all';
  app.nodes['recognition-notes'].handlers.change();
  for (let i = 0; i < 60; i++) {
    app.nodes['new-exercise'].handlers.click();
    assert.ok([2, 5].includes(app.read('recognitionTarget.string')));
    assert.ok(app.read('recognitionTarget.fret') <= 15);
  }
});

test('recognition request hides duplicates and other modes restore their assignment', () => {
  const app = trainer();
  app.nodes['training-mode'].value = 'recognition-visual';
  app.nodes['training-mode'].handlers.change();
  assert.equal(app.nodes['exercise-chord'].hidden, true);
  assert.equal(app.nodes['exercise-direction'].hidden, true);
  assert.equal(app.nodes['requested-string'].hidden, false);
  assert.match(app.nodes['starting-pitch'].className, /recognition-request/);
  app.nodes['training-mode'].value = 'full';
  app.nodes['training-mode'].handlers.change();
  assert.equal(app.nodes['exercise-chord'].hidden, false);
  assert.equal(app.nodes['exercise-direction'].hidden, false);
  assert.equal(app.nodes['requested-string'].hidden, false);
  assert.equal(app.nodes['starting-pitch'].className, 'starting-pitch request-panel');
});
