const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const scales = require('../scale-patterns.js');
const { trainer } = require('./helpers/trainer.cjs');

function configure(app, root, type, shape) {
  const anchors = { C: [5,'left'], A: [5,'right'], G: [6,'left'], E: [6,'right'], D: [4,'right'] };
  const [string,side] = anchors[shape];
  app.read(`configureExercise(${JSON.stringify({ root, type, string, side })})`);
}

test('all 70 combinations contain only the intended pentatonic pitches and a complete chord', () => {
  const expected = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10] };
  const chords = { major: [0, 4, 7], minor: [0, 3, 7] };
  for (const root of Object.keys(scales.naturals)) {
    for (const type of ['major', 'minor']) {
      for (const shape of ['C', 'A', 'G', 'E', 'D']) {
        const model = scales.build(root, type, shape);
        const label = `${root} ${type} ${shape}`;
        const intervals = new Set(model.notes.map(note => (note.midi - model.rootPC + 120) % 12));
        assert.deepEqual([...intervals].sort((a,b) => a-b), expected[type], label);
        const chordIntervals = new Set(model.chordNotes.map(note => (note.midi - model.rootPC + 120) % 12));
        assert.deepEqual([...chordIntervals].sort((a,b) => a-b), chords[type], label);
        assert.equal(model.notes.length, 12, label);
        assert.equal(model.pitches.size, 12, label);
        for (const note of model.notes) {
          assert.ok(note.fret >= 0 && note.fret <= 16, label);
          assert.equal(note.midi, note.open + note.fret, label);
        }
        for (const note of model.chordNotes) {
          assert.ok(model.notes.some(n => n.string === note.string && n.fret === note.fret), label);
        }
        assert.ok(model.roots.length > 0, label);
        assert.ok(model.roots.every(note => note.midi % 12 === model.rootPC), label);
      }
    }
  }
});

test('natural roots allow correctly spelled sharps and flats inside their scales', () => {
  assert.deepEqual(scales.build('A', 'major', 'E').scaleNames, ['A', 'B', 'C♯', 'E', 'F♯']);
  assert.deepEqual(scales.build('F', 'major', 'C').scaleNames, ['F', 'G', 'A', 'C', 'D']);
  assert.deepEqual(scales.build('C', 'minor', 'A').scaleNames, ['C', 'E♭', 'F', 'G', 'B♭']);
  assert.deepEqual(scales.build('F', 'minor', 'D').scaleNames, ['F', 'A♭', 'B♭', 'C', 'E♭']);
  assert.deepEqual(scales.build('B', 'major', 'G').scaleNames, ['B', 'C♯', 'D♯', 'F♯', 'G♯']);
});

test('all 168 trainer assignments derive their form from string and side and exclude A1', () => {
  const expectedForms = {
    6: ['G','E'], 5: ['C','A'], 4: ['E','D'],
    3: ['A','G'], 2: ['D','C'], 1: ['G','E']
  };
  let count = 0;
  for (const root of Object.keys(scales.naturals)) for (const type of ['major','minor']) {
    for (let string=1; string<=6; string++) for (const [sideIndex,side] of ['left','right'].entries()) {
      const model = scales.buildAssignment(root,string,side,type);
      assert.equal(model.shapeName, expectedForms[string][sideIndex]);
      assert.equal(model.startingRoot.string,string);
      assert.equal(model.startingRoot.midi % 12,scales.naturals[root]);
      assert.ok(model.notes.some(note => note.string === string && note.fret === model.startingRoot.fret));
      assert.ok(model.notes.every(note => note.midi >= 40 && note.fret >= 0 && note.fret <= 24));
      assert.equal(model.pitches.has(33),false,'A1 is never a permitted pattern pitch');
      assert.equal(model.pitches.size,12);
      assert.ok(scales.listNotes(model).every(note => !note.note.includes('undefined')));
      count++;
    }
  }
  assert.equal(count,168);
});

test('A on the B string at fret 10 derives left D and right C at the same octave', () => {
  for (const type of ['major','minor']) {
    const left = scales.buildAssignment('A',2,'left',type);
    const right = scales.buildAssignment('A',2,'right',type);
    assert.equal(left.shapeName,'D');
    assert.equal(right.shapeName,'C');
    assert.equal(left.startingRoot.fret,10);
    assert.equal(right.startingRoot.fret,10);
    assert.equal(left.startingRoot.midi,69);
    assert.equal(right.startingRoot.midi,69);
  }
  assert.deepEqual(scales.buildAssignment('A',2,'left','major').chordNotes.map(n => n.fret),[7,9,10,9]);
  assert.deepEqual(scales.buildAssignment('A',2,'right','major').chordNotes.map(n => n.fret),[12,11,9,10,9]);
});

test('near the nut, the root and complete assignment move together by an octave', () => {
  const model = scales.buildAssignment('F',6,'left','major');
  assert.equal(model.startingRoot.fret,13);
  assert.equal(model.startingRoot.midi,53);
  assert.ok(model.minFret >= 0);
  assert.throws(() => scales.build('A','major','E',4),/anchor/);
});

test('all assigned strings and sides allow completing the pattern in any order', () => {
  for (const root of Object.keys(scales.naturals)) for (const type of ['major','minor']) {
    for (let string=1; string<=6; string++) for (const side of ['left','right']) {
      const app = trainer();
      app.read(`configureExercise(${JSON.stringify({root,type,string,side})})`);
      const start = app.read('startingRoot.midi');
      app.read(`handleExerciseNote(${start})`);
      for (const midi of Array.from(app.read('[...exercise.pitches]')).filter(midi => midi !== start).reverse()) {
        app.read(`handleExerciseNote(${midi})`);
      }
      assert.equal(app.read('exerciseComplete()'),true,`${root} ${type}, string ${string}, ${side}`);
      assert.equal(app.nodes['expected-note'].textContent,root);
      assert.equal(app.read('exercise.side'),side);
      // The pattern frame replaces the Left/Right text.
      assert.match(app.nodes['board-scroll'].innerHTML,new RegExp(`frets ${app.read('exercise.minFret')} to ${app.read('exercise.maxFret')}\\.`));
      assert.match(app.nodes['board-scroll'].innerHTML,/class="board-frame"/);
    }
  }
});

test('exact-note hint includes octave and never accepts A1', () => {
  const app = trainer();
  assert.match(app.nodes['remaining-notes'].textContent,/\bA2\b/);
  assert.match(app.nodes['remaining-notes'].textContent,/\bA3\b/);
  assert.match(app.nodes['remaining-notes'].textContent,/\bA4\b/);
  assert.doesNotMatch(app.nodes['remaining-notes'].textContent,/\bA1\b/);
  app.read('handleExerciseNote(45); handleExerciseNote(33)');
  assert.equal(app.read('playedPitches.size'),1);
  assert.equal(app.nodes['played-note'].textContent,'A1');
  assert.match(app.nodes['exercise-result'].className,/feedback-error/);
  assert.match(app.nodes['exercise-feedback'].textContent,/outside this pattern \/ octave/);
});

test('known open CAGED chords and original A minor shape are preserved', () => {
  for (const [shape, root, expected] of [
    ['C','C',[null,3,2,0,1,0]], ['A','A',[null,0,2,2,2,0]],
    ['G','G',[3,2,0,0,0,3]], ['E','E',[0,2,2,1,0,0]], ['D','D',[null,null,0,2,3,2]]
  ]) {
    // Major E and D boxes need room below their anchor, so the corresponding
    // open grips are transposed by 12 frets, preserving their geometry.
    const model = scales.build(root, 'major', shape);
    const offset = model.anchorFret - (shape === 'C' || shape === 'G' ? 3 : 0);
    const actual = scales.strings.map(row => {
      const note = model.chordNotes.find(n => n.string === row.string);
      return note ? note.fret - offset : null;
    });
    assert.deepEqual(actual, expected);
  }
  assert.deepEqual(scales.build('A','minor','E').notes.map(n => n.midi), [45,48,50,52,55,57,60,62,64,67,69,72]);
});

test('every root / scale / CAGED combination completes in a freely chosen order', () => {
  for (const root of Object.keys(scales.naturals)) for (const type of ['major', 'minor']) for (const shape of ['C','A','G','E','D']) {
    const app = trainer();
    configure(app, root, type, shape);
    const start = app.read('startingRoot.midi');
    app.read(`handleExerciseNote(${start})`);
    const pitches = Array.from(app.read('[...exercise.pitches]')).filter(midi => midi !== start).reverse();
    for (const midi of pitches) app.read(`handleExerciseNote(${midi})`);
    assert.equal(app.read('exerciseComplete()'), true, `${root} ${type} ${shape}`);
    assert.equal(app.nodes['exercise-progress'].value, app.nodes['exercise-progress'].max);
  }
});

test('root and octave are required before free play; failures show a prominent error pitch', () => {
  const app = trainer();
  app.read('handleExerciseNote(48)');
  assert.equal(app.read('rootStarted'), false);
  assert.match(app.nodes['exercise-result'].className, /feedback-error/);
  assert.equal(app.nodes['played-note'].textContent, 'C3');
  app.read('handleExerciseNote(57)');
  assert.equal(app.read('playedPitches.size'), 0);
  assert.match(app.nodes['exercise-feedback'].textContent, /Start on A2/);
  app.read('handleExerciseNote(45)');
  assert.equal(app.read('rootStarted'), true);
  assert.match(app.nodes['exercise-result'].className, /feedback-correct/);
});

test('recorded-style synthetic audio covers all five forms, accidentals and low E2', () => {
  for (const sampleRate of [44100, 48000]) {
    for (const [root,type,shape] of [['E','minor','E'],['B','major','A'],['F','minor','C'],['G','major','G'],['C','minor','D']]) {
      const app = trainer(sampleRate);
      configure(app,root,type,shape);
      if (root === 'E' && type === 'minor' && shape === 'E') {
        app.read('configureExercise({ root: "E", string: 4, side: "left", type: "minor" })');
        assert.ok(app.read('exercise.pitches.has(40)'), 'open E2 is in this pattern');
      }
      const start = app.read('startingRoot.midi');
      app.play(start,150);
      const pitches = Array.from(app.read('[...exercise.pitches]')).filter(midi => midi !== start).reverse();
      for (const midi of pitches) app.play(midi,150);
      assert.equal(app.read('exerciseComplete()'),true,`${root} ${type} ${shape} at ${sampleRate}`);
    }
  }
});

test('outside-scale notes and wrong registers are rejected without losing progress', () => {
  const app = trainer();
  app.read('handleExerciseNote(45); handleExerciseNote(54)');
  assert.equal(app.read('playedPitches.size'), 1);
  assert.match(app.nodes['exercise-feedback'].textContent, /Outside A minor pentatonic/);
  assert.equal(app.nodes['played-note'].textContent, 'F♯3');
  app.read('handleExerciseNote(81)');
  assert.equal(app.read('playedPitches.size'), 1);
  assert.match(app.nodes['exercise-feedback'].textContent, /outside this pattern \/ octave/);
  app.read('handleExerciseNote(72); handleExerciseNote(48)');
  assert.equal(app.read('playedPitches.size'), 3);
  assert.match(app.nodes['exercise-result'].className, /feedback-correct/);
});

test('repeated or sustained notes do not add distinct progress; restarting requires a new root', () => {
  const app = trainer();
  app.read('handleExerciseNote(45); handleExerciseNote(45); handleExerciseNote(72); handleExerciseNote(45)');
  assert.equal(app.read('playedPitches.size'), 2);
  assert.match(app.nodes['exercise-feedback'].textContent, /already been played/);
  app.nodes['restart-exercise'].handlers.click();
  app.read('handleExerciseNote(45)');
  assert.equal(app.read('playedPitches.size'), 0);
  app.read('updateExerciseRelease(new Float32Array(1200), 1000); updateExerciseRelease(new Float32Array(1200), 1200); handleExerciseNote(45)');
  assert.equal(app.read('playedPitches.size'), 1);
});

test('after completion, further free play still flags wrong notes without changing progress', () => {
  const app = trainer();
  for (const midi of Array.from(app.read('[...exercise.pitches]'))) app.read(`handleExerciseNote(${midi})`);
  assert.equal(app.read('exerciseComplete()'), true);
  app.play(54,150);
  assert.match(app.nodes['exercise-result'].className, /feedback-error/);
  assert.equal(app.read('playedPitches.size'), app.read('exercise.pitches.size'));
  app.play(48,150);
  assert.match(app.nodes['exercise-result'].className, /feedback-correct/);
});

test('a new assigned string changes the required octave and resets progress', () => {
  const app = trainer();
  app.read('handleExerciseNote(45)');
  app.read('configureExercise({ root: "A", string: 4, side: "left", type: "minor" })');
  assert.equal(app.read('startingRoot.midi'), 57);
  assert.equal(app.read('playedPitches.size'), 0);
  app.read('handleExerciseNote(48); handleExerciseNote(45)');
  assert.equal(app.read('rootStarted'), false);
  app.read('handleExerciseNote(57)');
  assert.equal(app.read('rootStarted'), true);
});

test('hint markers: starting note, roots, CAGED chord shape, scale notes, degrees and played pitches', () => {
  const app = trainer();
  assert.doesNotMatch(app.nodes['board-scroll'].innerHTML, /board-dot/);
  app.nodes['toggle-hint'].handlers.click();
  assert.equal(app.nodes['exercise-hint'].hidden, false);
  assert.equal(app.nodes['toggle-hint']['aria-expanded'], 'true');
  const board = () => app.nodes['board-scroll'].innerHTML;
  const marks = kind => [...board().matchAll(new RegExp(`board-dot ${kind}[ "].*?<text class="dot-name"[^>]*>([^<]+)</text><text class="dot-degree"[^>]*>([^<]+)<`, 'g'))]
    .map(match => `${match[1]}:${match[2]}`).sort();
  // A minor pentatonic, E shape at fret 5, starting on A2 (string 6, fret 5).
  // Grip: string 5/7 E, 4/7 A, 3/5 C, 2/5 E, 1/5 A. C on string 6, fret 8 is
  // a chord tone outside the grip, so it stays a plain scale note.
  assert.deepEqual(marks('start'), ['A:R']);
  assert.deepEqual(marks('root'), ['A:R', 'A:R']);
  assert.deepEqual(marks('chord'), ['C:♭3', 'E:5', 'E:5']);
  assert.deepEqual(marks('scale'), ['C:♭3', 'C:♭3', 'D:4', 'D:4', 'G:♭7', 'G:♭7']);
  app.read('handleExerciseNote(45)');
  assert.equal((board().match(/class="board-check"/g) || []).length, 1);
  assert.match(board(), /board-dot start played/);
  configure(app,'C','minor','C');
  assert.match(app.nodes['exercise-chord'].textContent, /Cm/);
  assert.match(board(), />E♭</);
  assert.doesNotMatch(board(), /board-check/);
  app.nodes['toggle-hint'].handlers.click();
  assert.equal(app.nodes['exercise-hint'].hidden, true);
  assert.doesNotMatch(board(), /board-dot/);
  assert.match(board(), /class="board-frame"/);
});

test('New exercise always offers another natural-root assignment', () => {
  const app = trainer();
  for (let i=0; i<20; i++) {
    const previous = app.read('exercise.root + exercise.startingString + exercise.side + exercise.type');
    app.nodes['new-exercise'].handlers.click();
    assert.notEqual(app.read('exercise.root + exercise.startingString + exercise.side + exercise.type'), previous);
    assert.match(app.read('exercise.root'), /^[A-G]$/);
    assert.equal(app.read('playedPitches.size'), 0);
  }
});

test('Start/Stop cleans up audio and preserves distinct progress', async () => {
  const app = trainer();
  app.read(`
    let stoppedTracks = 0, closedContexts = 0, disconnectedSources = 0;
    const track = { stop() { stoppedTracks++; }, addEventListener() {} };
    AudioContext = class {
      constructor() { this.state = 'running'; this.sampleRate = 48000; }
      async resume() {}
      async close() { closedContexts++; this.state = 'closed'; }
      createMediaStreamSource() { return { connect() {}, disconnect() { disconnectedSources++; } }; }
      createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(buffer) { buffer.fill(0); } }; }
    };
    navigator.mediaDevices = { async getUserMedia() { return { getTracks() { return [track]; }, getAudioTracks() { return [track]; } }; } };
    listening = false;
  `);
  await app.nodes.start.handlers.click();
  app.read('handleExerciseNote(45)');
  await app.nodes.start.handlers.click();
  assert.equal(app.read('playedPitches.size'),1);
  assert.equal(app.read('stoppedTracks'),1);
  assert.equal(app.read('closedContexts'),1);
  assert.equal(app.read('disconnectedSources'),1);
  app.read('handleExerciseNote(48)');
  assert.equal(app.read('playedPitches.size'),1);
  await app.nodes.start.handlers.click();
  app.read('handleExerciseNote(48)');
  assert.equal(app.read('playedPitches.size'),2);
  await app.nodes.start.handlers.click();
});

test('microphone errors leave exercise progress intact and re-enable listening', async () => {
  const app = trainer();
  app.read('handleExerciseNote(45)');
  await app.read('startListening()');
  assert.equal(app.nodes.status.textContent, 'Microphone unavailable');
  assert.equal(app.nodes.start.disabled, false);
  assert.equal(app.read('playedPitches.size'), 1);
});

test('HTML wiring uses unique IDs, loads data before the app, and provides red feedback styles', () => {
  const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const css = fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(html.indexOf('src="scale-patterns.js"') < html.indexOf('src="app.js"'));
  assert.equal([...html.matchAll(/<select\b/g)].length, 4);
  assert.match(html, /<select id="audio-input"/);
  for (const id of Object.keys(trainer().nodes)) assert.ok(ids.includes(id), id);
  assert.match(css,/\.feedback-error\s*\{[^}]*color:\s*#b3261e/);
  assert.match(css,/#played-note\s*\{[^}]*font-weight:\s*850/);
});

test('the hint draws every note of the CAGED chord grip, also outside the scale box', () => {
  for (const root of Object.keys(scales.naturals)) for (const type of ['major','minor']) {
    for (let string=1; string<=6; string++) for (const side of ['left','right']) {
      const app = trainer();
      app.read(`configureExercise(${JSON.stringify({root,type,string,side})})`);
      const marks = JSON.parse(app.read('JSON.stringify(hintNotes())'));
      const grip = JSON.parse(app.read('JSON.stringify(exercise.chordNotes)'));
      for (const note of grip) {
        const mark = marks.find(m => m.string === note.string && m.fret === note.fret);
        assert.ok(mark, `${root} ${type} ${string} ${side}: grip note ${note.string}/${note.fret}`);
        assert.ok(['start','root','chord'].includes(mark.kind));
      }
      assert.equal(marks.filter(m => m.kind === 'start').length, 1);
      assert.equal(marks.filter(m => m.kind === 'chord').length, grip.filter(n => n.midi % 12 !== app.read('exercise.rootPC')).length);
    }
  }
});

test('without the hint, correct pitches appear on the fretboard as they are played', () => {
  const app = trainer();
  const board = () => app.nodes['board-scroll'].innerHTML;
  const dots = () => (board().match(/class="board-dot /g) || []).length;
  assert.equal(app.nodes['exercise-hint'].hidden, true);
  assert.equal(dots(), 0);
  app.read('handleExerciseNote(45)');
  assert.equal(dots(), 1);
  assert.match(board(), /board-dot start played/);
  app.read('handleExerciseNote(52)');
  assert.equal(dots(), 2);
  assert.match(board(), /board-dot chord played"><circle[^>]*\/><text class="dot-name"[^>]*>E<\/text><text class="dot-degree"[^>]*>5</);
  app.read('handleExerciseNote(53)');
  assert.equal(dots(), 2);
  app.read('handleExerciseNote(50)');
  assert.equal(dots(), 3);
  assert.match(board(), /board-dot scale played/);
  app.nodes['toggle-hint'].handlers.click();
  assert.equal(dots(), 12);
  app.nodes['toggle-hint'].handlers.click();
  assert.equal(dots(), 3);
  app.nodes['restart-exercise'].handlers.click();
  assert.equal(dots(), 0);
});

test('first-note mode shows played notes only after the root is found', () => {
  const app = trainer();
  app.nodes['training-mode'].value = 'root-first';
  app.nodes['training-mode'].handlers.change();
  app.read('handleExerciseNote(48)');
  assert.doesNotMatch(app.nodes['board-scroll'].innerHTML, /board-dot/);
  app.read('handleExerciseNote(45); handleExerciseNote(48)');
  assert.equal((app.nodes['board-scroll'].innerHTML.match(/class="board-dot /g) || []).length, 2);
});
