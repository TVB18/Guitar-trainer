const test = require('node:test');
const assert = require('node:assert/strict');
const { trainer, code } = require('./helpers/trainer.cjs');

const storage = 'var testStore = {};\nvar localStorage = { getItem: key => testStore[key] ?? null, setItem: (key, value) => { testStore[key] = value; } };\n';

function triadRun(types = ['spell'], length = 10, prefix = '') {
  const app = trainer(48000, prefix + code);
  app.read('let testClock = 1000; Date.now = () => testClock;');
  app.nodes['training-mode'].value = 'triads';
  app.nodes['training-mode'].handlers.change();
  for (const type of types) {
    app.nodes[`triad-type-${type}`].checked = true;
    app.nodes[`triad-type-${type}`].handlers.change();
  }
  for (const type of ['spell', 'find', 'play'].filter(type => !types.includes(type))) {
    app.nodes[`triad-type-${type}`].checked = false;
    app.nodes[`triad-type-${type}`].handlers.change();
  }
  app.nodes['run-length'].value = String(length);
  app.nodes['run-length'].handlers.change();
  app.nodes['new-exercise'].handlers.click();
  return app;
}

function question(app) {
  return JSON.parse(app.read('JSON.stringify({ ...triadQuestion, played: [...triadQuestion.played] })'));
}

function answer(app) {
  const q = question(app);
  const steps = { major: [0, 4, 7], minor: [0, 3, 7] }[q.chord.quality];
  if (q.type === 'spell') for (const step of steps) app.read(`answerTriadNote(${(q.chord.pc + step) % 12})`);
  else if (q.type === 'find') app.read(`answerTriadChord(${q.chord.pc}, "${q.chord.quality}")`);
  else {
    app.read(`heldNote = null; handleExerciseNote(${q.root.midi})`);
    for (const note of q.voicing.notes.filter(note => note.degree !== 'R')) app.read(`heldNote = null; handleExerciseNote(${note.midi})`);
  }
}

test('the 14 major triads from the PDF hold R, 3 and 5 of their chord', () => {
  const app = triadRun();
  assert.equal(app.read('triadShapes.length'), 14);
  for (let i = 0; i < 14; i++) {
    const shape = JSON.parse(app.read(`JSON.stringify(triadShapes[${i}])`));
    const strings = shape.notes.map(note => note[0]);
    assert.equal(strings[2] - strings[0], 2, 'three adjacent strings');
    for (const [string, fret, degree] of shape.notes) {
      const pc = app.read(`midiAt(${string}, ${fret}) % 12`);
      assert.equal(pc, (shape.rootPc + { R: 0, 3: 4, 5: 7 }[degree]) % 12, `${shape.shape} ${string}/${fret}`);
    }
  }
});

test('minor voicings lower the 3, fit frets 0–15 and follow the selected strings', () => {
  const app = triadRun();
  for (const quality of ['major', 'minor']) {
    for (let pc = 0; pc < 12; pc++) {
      const voicings = JSON.parse(app.read(`JSON.stringify(triadVoicings({ pc: ${pc}, quality: "${quality}" }))`));
      assert.ok(voicings.length >= 14, `${pc} ${quality}`);
      for (const voicing of voicings) {
        const pcs = voicing.notes.map(note => ((note.midi % 12) - pc + 12) % 12).sort((a, b) => a - b);
        assert.deepEqual(pcs, quality === 'major' ? [0, 4, 7] : [0, 3, 7]);
        for (const note of voicing.notes) assert.ok(note.fret >= 0 && note.fret <= 15);
      }
    }
  }
  // Open C minor on strings 1–3 would need fret -1, so it moves up an octave.
  const c = JSON.parse(app.read('JSON.stringify(triadVoicings({ pc: 0, quality: "minor" }).filter(v => v.notes[0].string === 1 && v.shape === "C"))'));
  assert.deepEqual(c.map(v => v.notes.map(n => n.fret)), [[11, 13, 12]]);
  for (const string of [1, 2, 3]) {
    app.nodes[`train-string-${string}`].checked = false;
    app.nodes[`train-string-${string}`].handlers.change();
  }
  const strings = JSON.parse(app.read('JSON.stringify(triadVoicings({ pc: 9, quality: "major" }).flatMap(v => v.notes.map(n => n.string)))'));
  assert.ok(strings.every(string => string >= 4));
});

test('triads are spelled from the root letter', () => {
  const app = triadRun();
  const spell = (pc, quality) => app.read(`spellTriad({ pc: ${pc}, quality: "${quality}" }).join(" ")`);
  assert.equal(spell(0, 'major'), 'C E G');
  assert.equal(spell(3, 'major'), 'E♭ G B♭');
  assert.equal(spell(6, 'major'), 'F♯ A♯ C♯');
  assert.equal(spell(8, 'minor'), 'G♯ B D♯');
  assert.equal(spell(10, 'minor'), 'B♭ D♭ F');
  assert.equal(spell(11, 'major'), 'B D♯ F♯');
});

test('type 1: the notes in the order R, 3, 5, by button or key', () => {
  const app = triadRun(['spell'], 3);
  assert.equal(app.nodes['recognition-board'].hidden, true);
  assert.equal((app.nodes['answer-buttons'].innerHTML.match(/<button/g) || []).length, 12);
  const q = question(app);
  const steps = { major: [0, 4, 7], minor: [0, 3, 7] }[q.chord.quality];
  assert.match(app.nodes['expected-note'].innerHTML, new RegExp(`chord-${q.chord.quality}`));
  // The 3 before the root is a mistake, but the order is kept.
  app.read(`answerTriadNote(${(q.chord.pc + steps[1]) % 12})`);
  assert.equal(app.read('runMistakes'), 1);
  assert.equal(app.read('triadQuestion.step'), 0);
  app.read(`answerTriadNote(${q.chord.pc})`);
  assert.equal(app.read('triadQuestion.step'), 1);
  assert.match(app.nodes['requested-string'].textContent, /^\S+ – (3|♭3) – 5$/);
  app.read(`answerTriadNote(${(q.chord.pc + steps[1]) % 12}); answerTriadNote(${(q.chord.pc + steps[2]) % 12})`);
  assert.equal(app.read('runCount'), 1);
  // Keys: H before a letter is a sharp.
  app.read('triadQuestion.chord = { pc: 2, quality: "major" }; triadQuestion.step = 0');
  app.read('handleTriadKey({ key: "D", target: {} }); handleTriadKey({ key: "h", target: {} }); handleTriadKey({ key: "f", target: {} }); handleTriadKey({ key: "a", target: {} })');
  assert.equal(app.read('runCount'), 2);
});

test('type 2: a coloured triad without names, answered with a chord button or M + letter', () => {
  const app = triadRun(['find'], 5);
  const q = question(app);
  const html = app.nodes['board-scroll'].innerHTML;
  assert.equal((html.match(/board-dot start/g) || []).length, 1);
  assert.equal((html.match(/board-dot chord/g) || []).length, 2);
  assert.doesNotMatch(html, /class="dot-name"[^>]*>[^<]/);
  assert.equal(app.nodes['board-note'].hidden, true);
  assert.equal((app.nodes['answer-buttons'].innerHTML.match(/<button/g) || []).length, 14);
  assert.match(app.nodes['answer-buttons'].innerHTML, /class="chord-minor" data-chord-pc="9" data-quality="minor">Am</);
  const other = q.chord.quality === 'major' ? 'minor' : 'major';
  app.read(`answerTriadChord(${q.chord.pc}, "${other}")`);
  assert.equal(app.read('runMistakes'), 1);
  assert.equal(app.read('triadStreak'), 0);
  app.read(`answerTriadChord(${q.chord.pc}, "${q.chord.quality}")`);
  assert.equal(app.read('runCount'), 1);
  app.read('triadQuestion.chord = { pc: 9, quality: "minor" }');
  app.read('handleTriadKey({ key: "m", target: {} })');
  assert.match(app.nodes['answer-buttons'].className, /minor-pending/);
  app.read('handleTriadKey({ key: "A", target: {} })');
  assert.equal(app.read('runCount'), 2);
  app.read('triadQuestion.chord = { pc: 6, quality: "minor" }');
  app.read('handleTriadKey({ key: "H", target: {} }); handleTriadKey({ key: "m", target: {} }); handleTriadKey({ key: "f", target: {} })');
  assert.equal(app.read('runCount'), 3);
});

test('type 3: find the root in its frame, then play the triad', () => {
  const app = triadRun(['play'], 2);
  assert.equal(app.read('[...triadTypes].join()'), 'play');
  const q = question(app);
  assert.match(app.nodes['exercise-title'].textContent, /^Find .+ on string \d$/);
  assert.match(app.nodes['board-scroll'].innerHTML, /board-requested/);
  const wrong = q.voicing.notes.find(note => note.degree !== 'R').midi;
  app.read(`handleExerciseNote(${wrong})`);
  assert.equal(app.read('runMistakes'), 1);
  app.read(`heldNote = null; handleExerciseNote(${q.root.midi})`);
  assert.equal(app.read('triadQuestion.rootFound'), true);
  assert.match(app.nodes['exercise-title'].className, /chord-title/);
  assert.equal((app.nodes['board-scroll'].innerHTML.match(/class="board-muted"/g) || []).length, 3);
  assert.match(app.nodes['board-chord'].innerHTML, /chord-symbol/);
  answer(app);
  assert.equal(app.read('runCount'), 1);
});

test('type 3 runs on its own: ticking it unticks 1 and 2, and the other way round', () => {
  const app = triadRun(['spell', 'find']);
  assert.equal(app.read('[...triadTypes].sort().join()'), 'find,spell');
  app.nodes['triad-type-play'].checked = true;
  app.nodes['triad-type-play'].handlers.change();
  assert.equal(app.read('[...triadTypes].join()'), 'play');
  assert.equal(app.nodes['triad-type-spell'].checked, false);
  app.nodes['triad-type-find'].checked = true;
  app.nodes['triad-type-find'].handlers.change();
  assert.equal(app.read('[...triadTypes].join()'), 'find');
  assert.equal(app.nodes['triad-type-play'].checked, false);
});

test('types 1 and 2 come in blocks; the triad heatmap is a grid of chords', () => {
  const app = triadRun(['spell', 'find'], 100);
  const types = [];
  for (let i = 0; i < 100; i++) { app.read('chooseTriadQuestion()'); types.push(question(app).type); }
  let run = 1;
  const runs = [];
  for (let i = 1; i < types.length; i++) { if (types[i] === types[i - 1]) run++; else { runs.push(run); run = 1; } }
  // The first block started before this loop, so it may look shorter.
  assert.ok(runs.length > 1 && runs.slice(1).every(length => length >= 3), runs.join());
  app.read('triadStats.times["9-minor"] = [1000]; triadStats.times["0-major"] = [9000]');
  app.nodes['toggle-heatmap'].handlers.click();
  const html = app.nodes['board-scroll'].innerHTML;
  assert.match(html, /<table class="chord-heat"/);
  assert.match(html, /heat-fast"><strong>Am<\/strong><small>1\.0/);
  assert.match(html, /heat-slow"><strong>C<\/strong><small>9\.0/);
  assert.equal((html.match(/<td/g) || []).length, 14);
  assert.equal(app.nodes['answer-buttons'].hidden, true);
  assert.equal(app.read('runStartedAt'), null);
  app.nodes['toggle-heatmap'].handlers.click();
  assert.equal(app.read('triadHeatmapShown'), false);
});

test('the triad mode keeps its own scoreboard, separate from the click mode', () => {
  const app = triadRun(['spell'], 2, storage);
  for (let i = 0; i < 2; i++) { app.read('testClock += 1500'); answer(app); }
  assert.match(app.nodes['exercise-result'].className, /feedback-run-complete/);
  assert.equal(app.read('triadStats.top10.length'), 1);
  assert.equal(app.read('triadStats.top10[0].types'), '1');
  assert.equal(app.read('clickStats.top10.length'), 0);
  assert.match(app.nodes['score-last'].textContent, /^Last run: 3\.0 s/);
  assert.equal(app.nodes['score-streak'].textContent, 'Streak: 2 · Best: 2');
  assert.ok(app.read('testStore["guitar-trainer-triad-stats"]'));
  app.nodes['reset-stats'].handlers.click();
  app.nodes['reset-stats'].handlers.click();
  assert.equal(app.read('triadStats.top10.length'), 0);
  // The setting is remembered.
  const saved = app.read('testStore["guitar-trainer-settings"]');
  const next = trainer(48000, storage.replace('{}', JSON.stringify({ 'guitar-trainer-settings': saved })) + code);
  assert.equal(next.read('trainingMode'), 'triads');
  assert.equal(next.read('[...triadTypes].join()'), 'spell');
});

test('weak chords come up more often', () => {
  const app = triadRun(['spell']);
  app.read('for (const chord of triadChords(false)) triadStats.times[chordKey(chord)] = [1000]; triadStats.times["0-major"] = [9000]; triadQuestion = null');
  let slow = 0;
  for (let i = 0; i < 3000; i++) if (app.read('chordKey(chooseTriadChord(false))') === '0-major') slow++;
  const share = 4 / (13 + 4);
  assert.ok(slow > 3000 * share * 0.7 && slow < 3000 * share * 1.3, `${slow}`);
});
