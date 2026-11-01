const test = require('node:test');
const assert = require('node:assert/strict');
const { trainer, code } = require('./helpers/trainer.cjs');

function clickRun(types = ['name'], length = 10, storage = '') {
  const app = trainer(48000, storage + code);
  app.read('let testClock = 1000; Date.now = () => testClock;');
  app.nodes['training-mode'].value = 'recognition-click';
  app.nodes['training-mode'].handlers.change();
  // Tick the wanted types first: the last ticked type cannot be unticked.
  for (const type of [...types, ...['name', 'find', 'nearest'].filter(type => !types.includes(type))]) {
    app.nodes[`click-type-${type}`].checked = types.includes(type);
    app.nodes[`click-type-${type}`].handlers.change();
  }
  app.nodes['run-length'].value = String(length);
  app.nodes['run-length'].handlers.change();
  app.nodes['new-exercise'].handlers.click();
  return app;
}

function question(app) {
  return JSON.parse(app.read('JSON.stringify({ ...clickQuestion, found: [...clickQuestion.found] })'));
}

function answer(app) {
  const q = question(app);
  if (q.type === 'name') app.read(`answerName(${q.pc})`);
  else for (const target of q.targets) app.read(`clickCell(${target.string}, ${target.fret})`);
}

test('the click mode shows its controls and needs no microphone', () => {
  const app = clickRun();
  for (const id of ['click-types', 'scoreboard', 'toggle-heatmap', 'recognition-controls', 'frame-controls', 'recognition-board']) {
    assert.equal(app.nodes[id].hidden, false, id);
  }
  assert.equal(app.nodes['run-length-label'].textContent, 'Questions per run');
  assert.equal(app.nodes['answer-buttons'].hidden, false);
  assert.match(app.nodes['answer-buttons'].innerHTML, /data-pc="0">C</);
  assert.equal((app.nodes['answer-buttons'].innerHTML.match(/<button/g) || []).length, 7);
  // The note itself is not named on the board.
  assert.equal(app.nodes['board-note'].hidden, true);
  assert.match(app.nodes['board-scroll'].innerHTML, /board-dot question/);
  // Sounds are ignored in this mode.
  app.read('handleExerciseNote(question => 0)');
  assert.equal(app.read('runMistakes'), 0);
});

test('type 1: buttons and keys answer, H before a letter makes it sharp', () => {
  const app = clickRun(['name'], 3);
  const q = question(app);
  app.read(`answerName(${(q.pc + 2) % 12})`);
  assert.equal(app.read('runMistakes'), 1);
  assert.equal(app.read('clickStreak'), 0);
  assert.match(app.nodes['exercise-result'].className, /feedback-error/);
  app.read('testClock += 1500');
  app.read(`answerName(${q.pc})`);
  assert.equal(app.read('runCount'), 1);
  // A wrong answer makes the position count at least 5 s.
  assert.equal(app.read(`averageTime({ string: ${q.seed.string}, fret: ${q.seed.fret} })`), 5000);
  const letters = { 0: 'c', 2: 'D', 4: 'e', 5: 'F', 7: 'g', 9: 'A', 11: 'b' };
  const next = question(app);
  app.read(`handleClickKey({ key: "${letters[next.pc]}", target: {} })`);
  assert.equal(app.read('runCount'), 2);
  assert.equal(app.read('clickStreak'), 1);
  app.read('handleClickKey({ key: "h", target: {} })');
  assert.equal(app.read('sharpPending'), true);
  assert.match(app.nodes['answer-buttons'].className, /sharp-pending/);
  app.read('handleClickKey({ key: "C", target: {} })');
  assert.equal(app.read('sharpPending'), false);
  // Typing in a number field is not an answer.
  app.read('handleClickKey({ key: "c", target: { tagName: "INPUT" } })');
});

test('all 12 notes show 12 buttons with sharp and flat names', () => {
  const app = clickRun();
  app.nodes['recognition-notes'].value = 'all';
  app.nodes['recognition-notes'].handlers.change();
  app.nodes['new-exercise'].handlers.click();
  assert.equal((app.nodes['answer-buttons'].innerHTML.match(/<button/g) || []).length, 12);
  assert.match(app.nodes['answer-buttons'].innerHTML, /C♯<small>D♭<\/small>/);
});

test('type 2: every occurrence inside the frame must be clicked', () => {
  const app = clickRun(['find']);
  for (let i = 0; i < 20; i++) {
    const q = question(app);
    assert.equal(q.type, 'find');
    assert.ok(q.targets.length >= 1);
    for (const target of q.targets) {
      assert.ok(target.fret >= q.frame.fromFret && target.fret <= q.frame.toFret);
      assert.ok(target.string >= q.frame.fromString && target.string <= q.frame.toString);
      assert.equal(target.midi % 12, q.pc);
    }
    app.read('runCount = 0; chooseClickQuestion(); renderExercise()');
  }
  app.read('clickQuestion = { ...clickQuestion, pc: 9, frame: { fromFret: 5, toFret: 8, fromString: 4, toString: 6 }, targets: [{ string: 6, fret: 5, midi: 45 }, { string: 4, fret: 7, midi: 57 }], found: new Set(), wrong: [], mistake: false }; renderExercise()');
  assert.match(app.nodes['board-scroll'].innerHTML, /class="board-cell" data-string="6" data-fret="5"/);
  app.read('clickCell(6, 5)');
  assert.equal(app.read('runCount'), 0);
  assert.equal(app.nodes['expected-position'].textContent, 'Found 1 / 2');
  assert.match(app.nodes['board-scroll'].innerHTML, /board-dot found played/);
  app.read('clickCell(5, 5)');
  assert.equal(app.read('runMistakes'), 1);
  assert.match(app.nodes['board-scroll'].innerHTML, /board-dot wrong/);
  app.read('clickCell(4, 7)');
  assert.equal(app.read('runCount'), 1);
});

test('type 3: the nearest occurrence on every selected string, within an odd fret range', () => {
  const app = clickRun(['nearest']);
  app.nodes['frame-frets'].value = '4';
  app.nodes['frame-frets'].handlers.change();
  assert.equal(app.read('JSON.stringify(nearestRange(7))'), '{"fromFret":5,"toFret":9}');
  assert.equal(app.read('JSON.stringify(nearestRange(0))'), '{"fromFret":0,"toFret":4}');
  assert.equal(app.read('JSON.stringify(nearestRange(15))'), '{"fromFret":11,"toFret":15}');
  for (let i = 0; i < 30; i++) {
    app.read('chooseClickQuestion()');
    const q = question(app);
    assert.equal(q.frame.toFret - q.frame.fromFret, 4);
    assert.ok(q.highlightFret >= q.frame.fromFret && q.highlightFret <= q.frame.toFret);
    assert.ok(q.targets.some(target => target.string === q.seed.string));
    for (const target of q.targets) assert.equal(target.midi % 12, q.pc);
    assert.equal(new Set(q.targets.map(target => target.string)).size, q.targets.length);
  }
  app.read('renderExercise()');
  assert.match(app.nodes['board-scroll'].innerHTML, /class="board-highlight"/);
});

test('mixed types come in blocks of at least 3 questions', () => {
  const app = clickRun(['name', 'find', 'nearest'], 100);
  const types = [];
  for (let i = 0; i < 200; i++) { app.read('chooseClickQuestion()'); types.push(question(app).type); }
  const blocks = [];
  for (const type of types) {
    if (blocks.length && blocks.at(-1).type === type && blocks.at(-1).n < 5) blocks.at(-1).n++;
    else blocks.push({ type, n: 1 });
  }
  assert.ok(new Set(types).size === 3);
  // The first block started before this loop and the last one may be cut off.
  for (const block of blocks.slice(1, -1)) assert.ok(block.n >= 3, JSON.stringify(blocks));
});

test('weak and untried positions are chosen more often than known ones', () => {
  const app = clickRun(['name']);
  app.read('for (const position of clickPositions()) recordTime(position, 1000); recordTime({ string: 6, fret: 5 }, 9000); for (let i = 0; i < 4; i++) recordTime({ string: 6, fret: 5 }, 9000);');
  assert.equal(app.read('heatLevel({ string: 6, fret: 5 })'), 'slow');
  assert.equal(app.read('positionWeight({ string: 6, fret: 5 })'), 4);
  assert.equal(app.read('positionWeight({ string: 6, fret: 7 })'), 1);
  let slow = 0;
  for (let i = 0; i < 4000; i++) if (app.read('positionKey(weightedChoice(clickPositions()))') === '6-5') slow++;
  const share = 4 / (app.read('clickPositions().length') - 1 + 4);
  assert.ok(slow > 4000 * share * 0.6 && slow < 4000 * share * 1.4, `${slow}`);
  // Only the last five times count.
  for (let i = 0; i < 5; i++) app.read('recordTime({ string: 6, fret: 5 }, 1500)');
  assert.equal(app.read('heatLevel({ string: 6, fret: 5 })'), 'fast');
});

test('the heatmap pauses the run and colours every position by its average', () => {
  const app = clickRun(['name']);
  app.read('recordTime({ string: 6, fret: 5 }, 1000); recordTime({ string: 5, fret: 0 }, 3000); recordTime({ string: 1, fret: 1 }, 7000)');
  app.read('testClock += 1000');
  app.nodes['toggle-heatmap'].handlers.click();
  assert.equal(app.read('heatmapShown'), true);
  assert.equal(app.read('runStartedAt'), null);
  assert.equal(app.nodes['answer-buttons'].hidden, true);
  assert.equal(app.nodes['heatmap-legend'].hidden, false);
  const html = app.nodes['board-scroll'].innerHTML;
  assert.match(html, /board-dot heat-fast/);
  assert.match(html, /board-dot heat-medium/);
  assert.match(html, /board-dot heat-slow/);
  assert.match(html, /board-dot heat-none/);
  // Answers are ignored while paused, and paused time does not count.
  const q = question(app);
  app.read(`answerName(${q.pc})`);
  assert.equal(app.read('runCount'), 0);
  app.read('testClock += 60000');
  app.nodes['toggle-heatmap'].handlers.click();
  assert.equal(app.read('heatmapShown'), false);
  app.read('testClock += 1000');
  app.read(`answerName(${q.pc})`);
  assert.equal(app.read(`clickStats.times["${q.seed.string}-${q.seed.fret}"].at(-1)`), 2000);
  assert.equal(app.read('runElapsed + (runStartedAt === null ? 0 : Date.now() - runStartedAt)'), 2000);
});

test('streaks, the top 10 and the last run are kept and can be reset', () => {
  const storage = 'var testStore = {};\nvar localStorage = { getItem: key => testStore[key] ?? null, setItem: (key, value) => { testStore[key] = value; } };\n';
  const app = clickRun(['name', 'nearest'], 2, storage);
  for (let run = 0; run < 12; run++) {
    app.nodes['new-exercise'].handlers.click();
    for (let i = 0; i < 2; i++) { app.read(`testClock += ${1000 + run * 100}`); answer(app); }
  }
  assert.match(app.nodes['exercise-result'].className, /feedback-run-complete/);
  assert.equal(app.read('clickStats.top10.length'), 10);
  assert.equal(app.read('clickStats.top10[0].average'), 1000);
  assert.equal(app.read('clickStats.top10[0].types'), '1+3');
  assert.equal(app.read('clickStats.bestStreak'), 24);
  assert.match(app.nodes['score-last'].textContent, /^Last run: 4\.2 s \(2\.10 s\/question\)$/);
  assert.equal((app.nodes['score-top10'].innerHTML.match(/<li>/g) || []).length, 10);
  assert.match(app.nodes['score-top10'].innerHTML, /1\.00 s\/q · 2 q · 0 mistakes · type 1\+3/);
  // A new trainer reads the saved stats.
  const saved = app.read('testStore["guitar-trainer-click-stats"]');
  const next = trainer(48000, storage.replace('{}', JSON.stringify({ 'guitar-trainer-click-stats': saved })) + code);
  assert.equal(next.read('clickStats.top10.length'), 10);
  // Reset needs a second click.
  app.nodes['reset-stats'].handlers.click();
  assert.equal(app.nodes['reset-stats'].textContent, 'Click again to confirm');
  assert.equal(app.read('clickStats.top10.length'), 10);
  app.nodes['reset-stats'].handlers.click();
  assert.equal(app.read('clickStats.top10.length'), 0);
  assert.equal(app.read('Object.keys(clickStats.times).length'), 0);
  assert.equal(app.nodes['score-streak'].textContent, 'Streak: 0 · Best: 0');
});

test('a wrong click resets the streak', () => {
  const app = clickRun(['name'], 10);
  answer(app); answer(app);
  assert.equal(app.read('clickStreak'), 2);
  const q = question(app);
  app.read(`answerName(${(q.pc + 1) % 12})`);
  assert.equal(app.read('clickStreak'), 0);
  assert.equal(app.nodes['score-streak'].textContent, 'Streak: 0 · Best: 2');
});

test('at least one question type stays selected and the selection is remembered', () => {
  const storage = 'var testStore = {};\nvar localStorage = { getItem: key => testStore[key] ?? null, setItem: (key, value) => { testStore[key] = value; } };\n';
  const app = clickRun(['find', 'nearest'], 10, storage);
  app.nodes['click-type-find'].checked = false;
  app.nodes['click-type-find'].handlers.change();
  app.nodes['click-type-nearest'].checked = false;
  app.nodes['click-type-nearest'].handlers.change();
  assert.equal(app.nodes['click-type-nearest'].checked, true);
  assert.equal(app.read('[...clickTypes].join()'), 'nearest');
  const saved = app.read('testStore["guitar-trainer-settings"]');
  const next = trainer(48000, storage.replace('{}', JSON.stringify({ 'guitar-trainer-settings': saved })) + code);
  assert.equal(next.read('trainingMode'), 'recognition-click');
  assert.equal(next.read('[...clickTypes].join()'), 'nearest');
  assert.equal(next.nodes['click-type-nearest'].checked, true);
  assert.equal(next.nodes['click-type-name'].checked, false);
});

test('continue automatically starts the next click run after the pause', () => {
  const app = clickRun(['name'], 1);
  app.nodes['auto-continue'].checked = true;
  app.nodes['auto-continue'].handlers.change();
  answer(app);
  assert.match(app.nodes['exercise-feedback'].textContent, /Next run in 3…$/);
  app.advanceTimers(3000);
  assert.equal(app.read('runActive'), true);
  assert.equal(app.read('runCount'), 0);
});
