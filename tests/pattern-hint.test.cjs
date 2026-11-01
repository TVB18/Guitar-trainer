const { test } = require('node:test');
const assert = require('node:assert/strict');
const scales = require('../scale-patterns.js');
const { trainer } = require('./helpers/trainer.cjs');

test('minor box numbers follow A minor from fret 5 towards higher frets', () => {
  for (const [shape,number,minFret] of [['E',1,5],['D',2,7],['C',3,9],['A',4,12],['G',5,14]]) {
    const model = scales.build('A','minor',shape,shape === 'G' ? 17 : shape === 'A' ? 12 : null);
    assert.equal(model.patternNumber,number);
    assert.equal(model.minFret,minFret);
  }
  assert.equal(scales.build('A','minor','G').minFret,2,'pattern 5 also sits below pattern 1');
});

test('major pattern numbers refer to the identical minor-reference box geometry', () => {
  const geometry = template => {
    const minimum = Math.min(...template.frets.flat());
    return template.frets.map(pair => pair.map(offset => offset - minimum));
  };
  for (const majorShape of ['C','A','G','E','D']) {
    const number = scales.build('A','major',majorShape).patternNumber;
    const minorShape = Object.keys(scales.patternNumbers.minor).find(shape => scales.patternNumbers.minor[shape] === number);
    assert.deepEqual(geometry(scales.templates[majorShape].major),geometry(scales.templates[minorShape].minor));
  }
});

test('the red pattern hint appears after five seconds and is independent of Show/Hide hint', () => {
  const app = trainer();
  assert.equal(app.nodes['pattern-hint'].hidden,true);
  app.nodes['new-exercise'].handlers.click();
  const number = app.read('exercise.patternNumber');
  app.advanceTimers(4999);
  assert.equal(app.nodes['pattern-hint'].hidden,true);
  app.advanceTimers(1);
  assert.equal(app.nodes['pattern-hint'].textContent,`Pattern ${number}`);
  assert.equal(app.nodes['pattern-hint'].hidden,false);
  app.nodes['toggle-hint'].handlers.click();
  app.nodes['toggle-hint'].handlers.click();
  assert.equal(app.nodes['exercise-hint'].hidden,true);
  assert.equal(app.nodes['pattern-hint'].hidden,false);
});

test('another New exercise cancels the old hint and starts a fresh five seconds', () => {
  const app = trainer();
  app.nodes['new-exercise'].handlers.click();
  app.advanceTimers(4000);
  app.nodes['new-exercise'].handlers.click();
  const number = app.read('exercise.patternNumber');
  app.advanceTimers(1000);
  assert.equal(app.nodes['pattern-hint'].hidden,true);
  app.advanceTimers(4000);
  assert.equal(app.nodes['pattern-hint'].textContent,`Pattern ${number}`);
  app.nodes['new-exercise'].handlers.click();
  assert.equal(app.nodes['pattern-hint'].hidden,true);
  assert.equal(app.nodes['pattern-hint'].textContent,'');
});
