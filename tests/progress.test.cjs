const test = require('node:test');
const assert = require('node:assert/strict');
const { trainer, code } = require('./helpers/trainer.cjs');

// A controllable clock for the run timer and the time limit.
function withClock(app) {
  app.read('var fakeNow = 1000000; Date.now = () => fakeNow;');
  return ms => { app.read(`fakeNow += ${ms}`); app.advanceTimers(ms); };
}

function clickRun(app) {
  app.nodes['training-mode'].value = 'recognition-click';
  app.nodes['training-mode'].handlers.change();
  app.nodes['new-exercise'].handlers.click();
}

function answerClick(app, right) {
  app.read(`answerName(${right ? 'clickQuestion.pc' : '(clickQuestion.pc + 2) % 12'})`);
  if (!right) app.read('answerName(clickQuestion.pc)');
}

test('every answer is recorded per item and a finished run keeps its missed items', () => {
  const app = trainer();
  clickRun(app);
  const seeds = [];
  for (let i = 0; i < 10; i++) {
    seeds.push(app.read('positionKey(clickQuestion.seed)'));
    answerClick(app, i % 3 !== 0);
  }
  const stats = JSON.parse(app.read('JSON.stringify(modeProgress())'));
  assert.equal(stats.runs.length, 1);
  assert.equal(stats.runs[0].questions, 10);
  assert.equal(stats.runs[0].correct, 6);
  assert.deepEqual(new Set(stats.missed), new Set([0, 3, 6, 9].map(i => seeds[i])));
  assert.equal(Object.values(stats.items).reduce((sum, item) => sum + item.attempts, 0), 10);
  assert.match(app.nodes['item-table'].innerHTML, /<th>Note<\/th>/);
  assert.match(app.nodes['round-summary'].innerHTML, /6\/10 correct/);
  assert.match(app.nodes['top-fails'].innerHTML, /#1/);
  assert.match(app.nodes['chart-accuracy'].innerHTML, /<svg/);
  assert.equal(app.nodes['review-missed'].disabled, false);
});

test('Review missed starts a run with only the missed items', () => {
  const app = trainer();
  clickRun(app);
  for (let i = 0; i < 10; i++) answerClick(app, i !== 2 && i !== 5);
  const missed = JSON.parse(app.read('JSON.stringify(modeProgress().missed)'));
  app.nodes['review-missed'].handlers.click();
  assert.equal(app.read('practiceSet'), 'missed');
  assert.equal(app.nodes['practice-set'].value, 'missed');
  assert.equal(app.read('runActive'), true);
  for (let i = 0; i < 6; i++) {
    assert.ok(missed.includes(app.read('positionKey(clickQuestion.seed)')));
    answerClick(app, true);
  }
});

test('Weakest 5 picks from the five worst items', () => {
  const app = trainer();
  app.nodes['training-mode'].value = 'triads';
  app.nodes['training-mode'].handlers.change();
  app.read(`for (const [i, chord] of triadChords(false).entries()) recordItem(triadItem(chord), { ok: i >= 5, time: 1000 })`);
  const worst = JSON.parse(app.read('JSON.stringify(triadChords(false).slice(0, 5).map(chordKey))'));
  app.nodes['practice-set'].value = 'weakest';
  app.nodes['practice-set'].handlers.change();
  for (let i = 0; i < 20; i++) assert.ok(worst.includes(app.read('chordKey(chooseTriadChord(false))')));
});

test('the time limit ends a question as missed and the run goes on', () => {
  const app = trainer();
  const tick = withClock(app);
  app.nodes['time-limit'].value = '5';
  app.nodes['time-limit'].handlers.input();
  assert.equal(app.nodes['time-limit-value'].textContent, '5 s');
  clickRun(app);
  const first = app.read('positionKey(clickQuestion.seed)');
  assert.equal(app.nodes['time-bar'].hidden, false);
  tick(3000);
  assert.equal(app.read('runCount'), 0);
  tick(2500);
  assert.equal(app.read('runCount'), 1);
  assert.equal(app.read('runMistakes'), 1);
  assert.match(app.nodes['exercise-feedback'].textContent, /^Time's up!/);
  const item = JSON.parse(app.read(`JSON.stringify(modeProgress().items["${first}"])`));
  assert.equal(item.timeouts, 1);
  assert.equal(item.correct, 0);
  assert.equal(app.read('modeProgress().streak'), 0);
});

test('Show answer counts as missed and shows the answer', () => {
  const app = trainer();
  clickRun(app);
  const name = app.read('recognitionNoteName(clickQuestion.pc)');
  app.nodes['show-answer'].handlers.click();
  assert.equal(app.read('runCount'), 1);
  assert.equal(app.nodes['exercise-feedback'].textContent, `Answer: It was ${name}.`);
  assert.equal(app.read('runItems[0].ok'), false);
});

test('in the scale modes the time limit ends the exercise and shows the hint', () => {
  const app = trainer();
  const tick = withClock(app);
  app.read('setTimeLimit(10)');
  app.nodes['new-exercise'].handlers.click();
  assert.equal(app.read('runActive'), true);
  tick(10100);
  assert.equal(app.read('exerciseTimedOut'), true);
  assert.equal(app.read('runCount'), 1);
  assert.equal(app.nodes['exercise-hint'].hidden, false);
  assert.match(app.nodes['exercise-feedback'].textContent, /^Time's up!/);
  // Notes no longer count for this exercise.
  app.read('handleExerciseNote(startingRoot.midi)');
  assert.equal(app.read('rootStarted'), false);
  assert.equal(app.read('runItems[0].timeout'), true);
});

test('scale exercises are recorded per scale and pattern', () => {
  const app = trainer();
  app.nodes['new-exercise'].handlers.click();
  const key = app.read('currentItem.key');
  assert.match(key, /^[A-G]-(major|minor)-[1-5]$/);
  app.read('handleExerciseNote(startingRoot.midi); for (const midi of targetPitches()) handleExerciseNote(midi)');
  assert.equal(app.read('runCount'), 1);
  assert.equal(app.read(`modeProgress().items["${key}"].correct`), 1);
  assert.match(app.nodes['pitch-chips'].innerHTML, /pitch done/);
});

test('the Listening box shows only in modes that use the microphone', () => {
  const app = trainer();
  assert.equal(app.nodes['listener-card'].hidden, false);
  clickRun(app);
  assert.equal(app.nodes['listener-card'].hidden, true);
  assert.equal(app.nodes['mic-note'].hidden, false);
  app.nodes['training-mode'].value = 'recognition-visual';
  app.nodes['training-mode'].handlers.change();
  assert.equal(app.nodes['listener-card'].hidden, false);
});

test('dark neon is the default style; practice set and time limit are remembered', () => {
  const fresh = trainer(48000, 'document.documentElement = { setAttribute(key, value) { this[key] = value; } };\n' + code);
  assert.equal(fresh.nodes.theme.value, 'neon');
  assert.equal(fresh.read('document.documentElement["data-theme"]'), 'neon');
  const store = { 'guitar-trainer-settings': JSON.stringify({ theme: 'classic', practiceSet: 'missed', timeLimit: 15 }) };
  const app = trainer(48000, `var testStore = ${JSON.stringify(store)};
var localStorage = { getItem: key => testStore[key] ?? null, setItem: (key, value) => { testStore[key] = value; } };
document.documentElement = { setAttribute(key, value) { this[key] = value; } };
` + code);
  assert.equal(app.nodes.theme.value, 'classic');
  assert.equal(app.read('practiceSet'), 'missed');
  assert.equal(app.read('timeLimit'), 15);
  assert.equal(app.nodes['time-limit-value'].textContent, '15 s');
});
