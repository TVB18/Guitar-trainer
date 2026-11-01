const test = require('node:test');
const assert = require('node:assert/strict');
const { trainer, code } = require('./helpers/trainer.cjs');

function chordFirst(app) {
  app.nodes['training-mode'].value = 'chord-first';
  app.nodes['training-mode'].handlers.change();
}

function grip(app) {
  return JSON.parse(app.read('JSON.stringify(exercise.grip.map(note => [note.string, note.fret, note.midi]))'));
}

test('chord mode uses the strings from the chord shape list', () => {
  const app = trainer();
  chordFirst(app);
  const strings = (type, shape, start) => app.read(`String(chordStrings("${type}", "${shape}", ${start}))`);
  assert.equal(strings('major', 'E', 6), '1,2,3,4,5,6');
  assert.equal(strings('major', 'A', 5), '2,3,4,5');
  assert.equal(strings('major', 'C', 5), '2,3,4,5');
  assert.equal(strings('major', 'D', 2), '1,2,3');
  assert.equal(strings('major', 'G', 6), '4,5,6');
  assert.equal(strings('major', 'G', 3), '1,2,3,4');
  assert.equal(strings('major', 'G', 1), '1,2,3,4');
  assert.equal(strings('minor', 'E', 4), '1,2,3,4,5,6');
  assert.equal(strings('minor', 'A', 3), '1,2,3,4,5');
  assert.equal(strings('minor', 'C', 5), '3,4,5');
  assert.equal(strings('minor', 'C', 2), '2,3,4');
  assert.equal(strings('minor', 'D', 1), '1,2,3');
  assert.equal(strings('minor', 'G', 6), '4,5,6');
  assert.equal(strings('minor', 'G', 3), 'null');
  // Left out: the D shape from string 4, and the G-shape minor chord from string 3 or 1.
  const invalid = [];
  for (const type of ['major', 'minor']) for (const string of [1, 2, 3, 4, 5, 6]) for (const side of ['left', 'right']) {
    if (!app.read(`chordStartPlayed({ type: "${type}", string: ${string}, side: "${side}" })`)) invalid.push(`${type}-${string}-${side}`);
  }
  assert.deepEqual(invalid, ['major-4-right', 'minor-1-left', 'minor-3-right', 'minor-4-right']);
});

test('the grips match the chord shape list', () => {
  const app = trainer();
  chordFirst(app);
  // Relative frets per string 6→1, as in the list (x = muted).
  const shape = (root, type, string, side) => {
    app.read(`configureExercise({ root: "${root}", type: "${type}", string: ${string}, side: "${side}" })`);
    const notes = grip(app);
    const low = Math.min(...notes.map(note => note[1]));
    return [6, 5, 4, 3, 2, 1].map(row => { const note = notes.find(n => n[0] === row); return note ? note[1] - low : 'x'; }).join('');
  };
  assert.equal(shape('C', 'major', 5, 'left'), 'x3201x');   // C shape
  assert.equal(shape('C', 'major', 5, 'right'), 'x0222x');  // A shape
  assert.equal(shape('C', 'major', 6, 'left'), '320xxx');   // G shape, root on 6
  assert.equal(shape('A', 'major', 3, 'right'), 'xx0003');  // G shape, root on 3
  assert.equal(shape('E', 'major', 6, 'right'), '022100');  // E shape
  assert.equal(shape('D', 'major', 2, 'left'), 'xxx010');   // D shape (xxx232 shifted)
  assert.equal(shape('C', 'minor', 5, 'left'), 'x310xx');   // C shape, root on 5
  assert.equal(shape('C', 'minor', 2, 'right'), 'xx101x');  // C shape, root on 2
  assert.equal(shape('C', 'minor', 5, 'right'), 'x02210');  // A shape (x13321 shifted)
  assert.equal(shape('C', 'minor', 6, 'left'), '310xxx');   // G shape, root on 6
  assert.equal(shape('E', 'minor', 6, 'right'), '022000');  // E shape
  assert.equal(shape('D', 'minor', 2, 'left'), 'xxx120');   // D shape (xxx231 shifted)
});

test('chord mode finds the root first, then frames the grip and plays its notes', () => {
  const app = trainer();
  chordFirst(app);
  assert.equal(app.nodes['exercise-title'].textContent, 'Find A on string 6');
  assert.match(app.nodes['board-scroll'].innerHTML, /The root is inside the frame/);
  assert.doesNotMatch(app.nodes['board-scroll'].innerHTML, /board-dot|board-muted/);
  assert.equal(app.nodes['board-chord'].hidden, true);
  app.read('handleExerciseNote(45)');
  assert.equal(app.nodes['exercise-title'].textContent, 'Am');
  // The chord label shows symbol and type, coloured by chord type; so does the title.
  assert.equal(app.nodes['board-chord'].innerHTML, '<span class="chord-symbol">Am</span><span class="chord-type">minor</span>');
  assert.equal(app.nodes['board-chord'].className, 'board-chord chord-minor');
  assert.equal(app.nodes['board-chord'].hidden, false);
  assert.equal(app.nodes['board-chord'].style.top, '4px');
  assert.equal(app.nodes['exercise-title'].className, 'chord-title chord-minor');
  assert.match(app.nodes['training-mode-help'].textContent, /mute each note before the next one/);
  assert.equal(app.nodes['exercise-chord'].textContent, 'Chord tones: A – C – E · Strings 1–6');
  assert.equal(app.nodes['scale-notes'].hidden, true);
  assert.match(app.nodes['exercise-feedback'].textContent, /play the notes of the chord shape/);
  assert.match(app.nodes['board-scroll'].innerHTML, /chord shape is inside the frame: frets 5 to 7, strings 1 to 6/);
  assert.equal(app.nodes['progress-text'].textContent, '1 / 6 chord notes');
  // No "Pattern N" hint in this mode.
  app.advanceTimers(10000);
  assert.equal(app.nodes['pattern-hint'].hidden, true);
  // A scale note that is not a chord tone, and a chord tone outside the grip.
  app.read('handleExerciseNote(55)');
  assert.match(app.nodes['exercise-feedback'].textContent, /Not in the Am chord/);
  app.read('handleExerciseNote(48)');
  assert.match(app.nodes['exercise-feedback'].textContent, /not in this shape/);
  for (const [, , midi] of grip(app).filter(note => note[2] !== 45 && note[2] !== 69)) app.read(`handleExerciseNote(${midi})`);
  assert.equal(app.read('exerciseComplete()'), false);
  assert.equal((app.nodes['board-scroll'].innerHTML.match(/board-dot/g) || []).length, 5);
  app.read('handleExerciseNote(69)');
  assert.equal(app.read('exerciseComplete()'), true);
  assert.match(app.nodes['exercise-feedback'].textContent, /every pitch in this chord shape/);
});

test('chord mode marks muted strings and shows only the grip in the hint', () => {
  const app = trainer();
  chordFirst(app);
  // The D shape on string 2 plays strings 1–3 only.
  app.read('configureExercise({ root: "A", type: "major", string: 2, side: "left" })');
  assert.equal(app.read('exercise.shapeName'), 'D');
  const start = app.read('startingRoot.midi');
  app.read(`handleExerciseNote(${start})`);
  assert.deepEqual(grip(app).map(note => note[0]).sort(), [1, 2, 3]);
  const html = app.nodes['board-scroll'].innerHTML;
  assert.equal((html.match(/board-muted/g) || []).length, 3);
  app.nodes['toggle-hint'].handlers.click();
  assert.equal((app.nodes['board-scroll'].innerHTML.match(/class="board-dot/g) || []).length, 3);
  assert.equal(app.nodes['exercise-chord'].textContent, 'Chord tones: A – C♯ – E · Strings 1–3');
});

test('switching to chord mode moves a D shape on string 4 to the other side', () => {
  const app = trainer();
  app.read('configureExercise({ root: "G", type: "major", string: 4, side: "right" })');
  chordFirst(app);
  assert.equal(app.read('exercise.side'), 'left');
  assert.equal(app.read('exercise.shapeName'), 'E');
  for (let i = 0; i < 40; i++) {
    app.nodes['new-exercise'].handlers.click();
    assert.ok(app.read('chordStartPlayed({ type: exercise.type, string: exercise.startingString, side: exercise.side })'));
  }
});

test('chord mode is remembered as a setting', () => {
  const storage = 'var testStore = {};\nvar localStorage = { getItem: key => testStore[key] ?? null, setItem: (key, value) => { testStore[key] = value; } };\n';
  const app = trainer(48000, storage + code);
  chordFirst(app);
  const saved = app.read('testStore["guitar-trainer-settings"]');
  assert.match(saved, /chord-first/);
  const next = trainer(48000, storage.replace('{}', JSON.stringify({ 'guitar-trainer-settings': saved })) + code);
  assert.equal(next.read('trainingMode'), 'chord-first');
  assert.equal(next.nodes['exercise-title'].textContent, 'Find A on string 6');
});
