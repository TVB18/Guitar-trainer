// Spell the triad: triads (R, 3, 5) of major and minor chords. Types 1 and 2
// are answered with the mouse or the keyboard; type 3 is played on the guitar
// and runs on its own. Loaded before app.js, like click-trainer.js.

const triadTypeNames = { spell: "Spell the triad", find: "Find the chord", play: "Play the triad" };
const triadTypeNumbers = { spell: 1, find: 2, play: 3 };
const triadTypes = new Set(["spell"]);
const triadStatsKey = "guitar-trainer-triad-stats";

// Major triads on three adjacent strings, from page 3 of
// Assets/Guthrie_Trapp_Concepts_ALL_TABS.pdf ("Triads in Groups Of 3"),
// written in open position: string, fret and degree. Minor triads lower the 3
// by one fret. They move up the neck with the root.
const triadShapes = [
  { shape: "C", rootPc: 0, notes: [[1, 0, "3"], [2, 1, "R"], [3, 0, "5"]] },
  { shape: "C", rootPc: 0, notes: [[2, 1, "R"], [3, 0, "5"], [4, 2, "3"]] },
  { shape: "C", rootPc: 0, notes: [[3, 0, "5"], [4, 2, "3"], [5, 3, "R"]] },
  { shape: "C", rootPc: 0, notes: [[4, 2, "3"], [5, 3, "R"], [6, 3, "5"]] },
  { shape: "A", rootPc: 9, notes: [[1, 0, "5"], [2, 2, "3"], [3, 2, "R"]] },
  { shape: "A", rootPc: 9, notes: [[2, 2, "3"], [3, 2, "R"], [4, 2, "5"]] },
  { shape: "G", rootPc: 7, notes: [[2, 0, "3"], [3, 0, "R"], [4, 0, "5"]] },
  { shape: "G", rootPc: 7, notes: [[3, 0, "R"], [4, 0, "5"], [5, 2, "3"]] },
  { shape: "G", rootPc: 7, notes: [[4, 0, "5"], [5, 2, "3"], [6, 3, "R"]] },
  { shape: "E", rootPc: 4, notes: [[1, 0, "R"], [2, 0, "5"], [3, 1, "3"]] },
  { shape: "E", rootPc: 4, notes: [[2, 0, "5"], [3, 1, "3"], [4, 2, "R"]] },
  { shape: "E", rootPc: 4, notes: [[3, 1, "3"], [4, 2, "R"], [5, 2, "5"]] },
  { shape: "D", rootPc: 2, notes: [[1, 2, "3"], [2, 3, "R"], [3, 2, "5"]] },
  { shape: "D", rootPc: 2, notes: [[4, 0, "R"], [5, 0, "5"], [6, 2, "3"]] }
];

// Chord names: flats for the usual major keys, sharps for the usual minor keys.
const triadRootNames = {
  major: ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"],
  minor: ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"]
};
const triadIntervals = { major: [0, 4, 7], minor: [0, 3, 7] };
const triadDegrees = { major: ["R", "3", "5"], minor: ["R", "♭3", "5"] };
const naturalPcs = [0, 2, 4, 5, 7, 9, 11];

let triadStats = { times: {}, top10: [], bestStreak: 0 };
let triadQuestion = null;
let triadBlock = { type: null, left: 0 };
let triadStreak = 0;
let triadHeatmapShown = false;
let triadHeatmapSince = null;
let triadPrefix = { sharp: false, minor: false };

function triadMode() {
  return trainingMode === "triads";
}

// Type 3 uses the microphone; it is never mixed with types 1 and 2.
function triadSound() {
  return triadMode() && triadTypes.has("play");
}

function chordKey(chord) {
  return `${chord.pc}-${chord.quality}`;
}

function triadChordName(chord) {
  return triadRootNames[chord.quality][chord.pc] + chordTypes[chord.quality].symbol;
}

// Spell R, 3 and 5 from the root's letter, so E♭ gives E♭ – G – B♭.
function spellTriad(chord) {
  const letters = ["C", "D", "E", "F", "G", "A", "B"];
  const root = triadRootNames[chord.quality][chord.pc];
  const index = letters.indexOf(root[0]);
  return triadIntervals[chord.quality].map((interval, step) => {
    const letter = letters[(index + step * 2) % 7];
    const offset = ((chord.pc + interval - naturalPcs[letters.indexOf(letter)]) % 12 + 18) % 12 - 6;
    return letter + ({ "-2": "𝄫", "-1": "♭", 0: "", 1: "♯", 2: "𝄪" }[offset] ?? "");
  });
}

function loadTriadStats() {
  try {
    const saved = JSON.parse(localStorage.getItem(triadStatsKey));
    if (saved && typeof saved === "object") {
      triadStats = {
        times: saved.times && typeof saved.times === "object" ? saved.times : {},
        top10: Array.isArray(saved.top10) ? saved.top10.slice(0, 10) : [],
        bestStreak: Number.isInteger(saved.bestStreak) ? saved.bestStreak : 0,
        last: saved.last
      };
    }
  } catch {
    // Missing or broken stats start empty.
  }
}

function saveTriadStats() {
  try {
    localStorage.setItem(triadStatsKey, JSON.stringify(triadStats));
  } catch {
    // The trainer keeps working without saved stats.
  }
}

function triadAverage(chord) {
  const times = triadStats.times[chordKey(chord)];
  return times?.length ? times.reduce((sum, time) => sum + time, 0) / times.length : null;
}

function triadLevel(chord) {
  const average = triadAverage(chord);
  return average === null ? "none" : average < heatFast ? "fast" : average <= heatSlow ? "medium" : "slow";
}

function triadWeight(chord) {
  return { none: 4, slow: 4, medium: 2, fast: 1 }[triadLevel(chord)];
}

// Every place a triad fits on frets 0–15 and the selected strings.
function triadVoicings(chord) {
  const voicings = [];
  for (const shape of triadShapes) {
    if (!shape.notes.every(([string]) => recognitionStrings.has(string))) continue;
    const base = (chord.pc - shape.rootPc + 12) % 12;
    for (const shift of [base, base + 12]) {
      const notes = shape.notes.map(([string, fret, degree], index) => {
        const moved = fret + shift - (chord.quality === "minor" && degree === "3" ? 1 : 0);
        return { string, fret: moved, midi: midiAt(string, moved), degree: degree === "3" ? triadDegrees[chord.quality][1] : degree };
      });
      if (notes.every(note => note.fret >= 0 && note.fret <= 15)) voicings.push({ shape: shape.shape, notes });
    }
  }
  return voicings;
}

function triadChords(needVoicing) {
  const pcs = recognitionNotes === "all" ? [...Array(12).keys()] : naturalPcs;
  return pcs.flatMap(pc => ["major", "minor"].map(quality => ({ pc, quality })))
    .filter(chord => !needVoicing || triadVoicings(chord).length);
}

function chooseTriadChord(needVoicing) {
  const previous = triadQuestion ? chordKey(triadQuestion.chord) : null;
  let chords = practiceFilter(triadChords(needVoicing), triadItem);
  if (chords.length > 1) chords = chords.filter(chord => chordKey(chord) !== previous);
  const total = chords.reduce((sum, chord) => sum + triadWeight(chord), 0);
  let pick = Math.random() * total;
  for (const chord of chords) {
    pick -= triadWeight(chord);
    if (pick < 0) return chord;
  }
  return chords.at(-1);
}

function nextTriadType() {
  if (triadSound()) return "play";
  if (triadBlock.left > 0 && triadTypes.has(triadBlock.type)) {
    triadBlock.left--;
    return triadBlock.type;
  }
  const types = [...triadTypes];
  const others = types.length > 1 ? types.filter(type => type !== triadBlock.type) : types;
  triadBlock = { type: others[Math.floor(Math.random() * others.length)], left: randomBetween(3, 5) - 1 };
  return triadBlock.type;
}

function chooseTriadQuestion() {
  const type = nextTriadType();
  const chord = chooseTriadChord(type !== "spell");
  const question = { type, chord, step: 0, wrong: [], mistake: false, startedAt: Date.now(), voicing: null, rootFound: false, played: new Set(), rootFrame: null };
  if (type !== "spell" && chord) {
    const voicings = triadVoicings(chord);
    question.voicing = voicings[Math.floor(Math.random() * voicings.length)];
    question.root = question.voicing.notes.find(note => note.degree === "R");
    question.rootFrame = frameAround(question.root);
  }
  triadQuestion = question;
  triadPrefix = { sharp: false, minor: false };
  if (chord) startItem(triadItem(chord));
}

function restartTriadRun(start = false) {
  cancelNextExercise();
  pauseRunClock();
  hideTriadHeatmap(false);
  runActive = start;
  runElapsed = 0;
  runCount = 0;
  runMistakes = 0;
  lastCorrectAt = null;
  triadBlock = { type: null, left: 0 };
  runLength = readRunLength("run-length");
  startRunItems();
  chooseTriadQuestion();
  renderExercise();
  updateRunTime();
  if (start && (listening || !triadSound())) startRunClock();
  setExerciseFeedback("neutral", null, !start ? "Click New run when ready."
    : triadSound() && !listening ? "Start listening to begin the timed run." : "Answer as fast as you can.");
}

function triadAnswerAllowed() {
  return triadMode() && runActive && runCount < runLength && !triadHeatmapShown && nextExerciseTimer === null && triadQuestion?.chord;
}

function triadMistake(message, midi = null) {
  triadQuestion.mistake = true;
  runMistakes++;
  triadStreak = 0;
  updateRunTime();
  renderTriad();
  setExerciseFeedback("error", midi, message);
}

function triadQuestionDone(midi = null) {
  const elapsed = Date.now() - triadQuestion.startedAt;
  const key = chordKey(triadQuestion.chord);
  // A question with a wrong answer counts at least as slow.
  triadStats.times[key] = [...(triadStats.times[key] || []), Math.round(triadQuestion.mistake ? Math.max(elapsed, heatSlow) : elapsed)].slice(-heatHistory);
  if (!triadQuestion.mistake) {
    triadStreak++;
    triadStats.bestStreak = Math.max(triadStats.bestStreak, triadStreak);
  }
  recordItem(currentItem, { ok: !triadQuestion.mistake, time: elapsed });
  runCount++;
  saveTriadStats();
  if (runCount >= runLength) {
    finishTriadRun(midi);
    return;
  }
  const name = triadChordName(triadQuestion.chord);
  chooseTriadQuestion();
  renderExercise();
  updateRunTime();
  setExerciseFeedback("correct", midi, `Correct, ${name}! ${(elapsed / 1000).toFixed(1)} s`);
}

function finishTriadRun(midi = null) {
  pauseRunClock();
  runActive = false;
  const entry = {
    at: new Date().toISOString(),
    types: [...triadTypes].map(type => triadTypeNumbers[type]).sort().join("+"),
    questions: runLength,
    mistakes: runMistakes,
    time: Math.round(runElapsed),
    average: Math.round(runElapsed / runLength)
  };
  triadStats.last = entry;
  triadStats.top10 = [...triadStats.top10, entry].sort((a, b) => a.average - b.average || a.mistakes - b.mistakes).slice(0, 10);
  saveTriadStats();
  recordRun(entry.types);
  updateRunTime();
  renderExercise();
  const summary = `Run complete in ${(entry.time / 1000).toFixed(1)} s (${(entry.average / 1000).toFixed(2)} s/question) with ${entry.mistakes} ${entry.mistakes === 1 ? "mistake" : "mistakes"}!`;
  if (autoContinue) scheduleNext("run-complete", midi, summary, "Next run");
  else setExerciseFeedback("run-complete", midi, `${summary} Choose New run to try again.`);
}

// Type 1: notes in the order R, 3, 5.
function answerTriadNote(pc) {
  if (!triadAnswerAllowed() || triadQuestion.type !== "spell") return;
  triadPrefix = { sharp: false, minor: false };
  const chord = triadQuestion.chord;
  const expected = (chord.pc + triadIntervals[chord.quality][triadQuestion.step]) % 12;
  if (pc !== expected) {
    triadMistake(`Not ${recognitionNoteName(pc)}. Find the ${triadDegrees[chord.quality][triadQuestion.step]} of ${triadChordName(chord)}.`);
    return;
  }
  triadQuestion.step++;
  if (triadQuestion.step === 3) {
    triadQuestionDone();
    return;
  }
  renderTriad();
  setExerciseFeedback("correct", null, `Correct. Now the ${triadDegrees[chord.quality][triadQuestion.step]}.`);
}

// Type 2: the chord shown on the board.
function answerTriadChord(pc, quality) {
  if (!triadAnswerAllowed() || triadQuestion.type !== "find") return;
  triadPrefix = { sharp: false, minor: false };
  if (pc === triadQuestion.chord.pc && quality === triadQuestion.chord.quality) triadQuestionDone();
  else triadMistake(`Not ${triadChordName({ pc, quality })}. Look at the root and the 3.`);
}

// Type 3: notes from the microphone, root first, then the triad in any order.
function handleTriadNote(midi, time, heldFor) {
  if (!triadAnswerAllowed() || triadQuestion.type !== "play") return;
  const question = triadQuestion;
  const wrong = question.rootFound ? !question.voicing.notes.some(note => note.midi === midi) : midi !== question.root.midi;
  if (wrong && time !== null) {
    // The same mute filters as the recognition modes.
    if (lastCorrectAt !== null && time - lastCorrectAt < mistakeGraceMs) return;
    if (heldFor < mistakeHoldMs) return;
  }
  heldNote = midi;
  if (wrong) {
    triadMistake(question.rootFound
      ? `Not in this ${triadChordName(question.chord)} triad. Play a note inside the frame.`
      : `Find ${pitchLabel(question.root.midi)} on string ${question.root.string}. Check the octave too.`, midi);
    return;
  }
  lastCorrectAt = time;
  question.played.add(midi);
  if (!question.rootFound) {
    question.rootFound = true;
    renderTriad();
    setExerciseFeedback("correct", midi, "Root found! Now play the other notes of the triad, one at a time.");
    return;
  }
  if (question.played.size === 3) {
    triadQuestionDone(midi);
    return;
  }
  renderTriad();
  setExerciseFeedback("correct", midi, "Correct. Play the next note of the triad.");
}

// Show answer, or the time limit: the question counts as missed and the run goes on.
function triadGiveUp(timeout) {
  if (!triadAnswerAllowed()) return;
  const question = triadQuestion;
  const elapsed = Date.now() - question.startedAt;
  const key = chordKey(question.chord);
  question.mistake = true;
  runMistakes++;
  triadStreak = 0;
  triadStats.times[key] = [...(triadStats.times[key] || []), Math.round(Math.max(elapsed, heatSlow))].slice(-heatHistory);
  recordItem(currentItem, { ok: false, time: elapsed, timeout });
  const name = triadChordName(question.chord);
  const answer = question.type === "spell" ? `${name} is ${spellTriad(question.chord).join(" – ")}.` : `It was ${name}.`;
  runCount++;
  saveTriadStats();
  if (runCount >= runLength) {
    finishTriadRun();
    return;
  }
  chooseTriadQuestion();
  renderExercise();
  updateRunTime();
  setExerciseFeedback("error", null, `${timeout ? "Time's up!" : "Answer:"} ${answer}`);
}

const triadKeyPcs = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// Keys ignore case. H before a letter makes it sharp; M before a letter makes
// the chord minor (type 2). The prefixes can come in any order.
function handleTriadKey(event) {
  if (!triadMode() || event.ctrlKey || event.metaKey || event.altKey) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName || "")) return;
  const key = String(event.key).toLowerCase();
  if (key === "h" || (key === "m" && triadQuestion?.type === "find")) {
    const prefix = key === "h" ? "sharp" : "minor";
    triadPrefix[prefix] = !triadPrefix[prefix];
    renderTriadButtons();
    event.preventDefault?.();
    return;
  }
  if (!(key in triadKeyPcs)) return;
  event.preventDefault?.();
  const pc = (triadKeyPcs[key] + (triadPrefix.sharp ? 1 : 0)) % 12;
  if (triadQuestion?.type === "find") answerTriadChord(pc, triadPrefix.minor ? "minor" : "major");
  else answerTriadNote(pc);
}

function renderTriadButtons() {
  const container = exerciseUI["answer-buttons"];
  const type = triadQuestion?.type;
  const show = triadMode() && (type === "spell" || type === "find") && !triadHeatmapShown;
  container.hidden = !show;
  if (!show) return;
  const pending = (triadPrefix.sharp ? " sharp-pending" : "") + (triadPrefix.minor ? " minor-pending" : "");
  if (type === "spell") {
    container.className = `answer-buttons all-notes${pending}`;
    container.innerHTML = [...Array(12).keys()].map(pc => {
      const [name, flat] = recognitionNoteName(pc).split(" / ");
      return `<button type="button" data-pc="${pc}">${name}${flat ? `<small>${flat}</small>` : ""}</button>`;
    }).join("");
    return;
  }
  const pcs = recognitionNotes === "all" ? [...Array(12).keys()] : naturalPcs;
  container.className = `answer-buttons chord-buttons${recognitionNotes === "all" ? " all-notes" : ""}${pending}`;
  container.innerHTML = ["major", "minor"].map(quality => pcs.map(pc =>
    `<button type="button" class="chord-${quality}" data-chord-pc="${pc}" data-quality="${quality}">${triadChordName({ pc, quality })}</button>`).join("")).join("");
}

function hideTriadHeatmap(resume = true) {
  if (!triadHeatmapShown) return;
  triadHeatmapShown = false;
  if (triadQuestion && triadHeatmapSince !== null) triadQuestion.startedAt += Date.now() - triadHeatmapSince;
  triadHeatmapSince = null;
  if (resume && runActive && (listening || !triadSound())) startRunClock();
}

function toggleTriadHeatmap() {
  if (!triadMode()) return;
  if (triadHeatmapShown) {
    hideTriadHeatmap();
    setExerciseFeedback("neutral", null, runActive ? "Continue." : "Click New run when ready.");
  } else {
    triadHeatmapShown = true;
    triadHeatmapSince = Date.now();
    pauseRunClock();
    updateRunTime();
    setExerciseFeedback("neutral", null, "Heatmap shown, the run is paused. Click Heatmap again to continue.");
  }
  renderExercise();
}

// The triad heatmap is a grid of chords, not fretboard positions.
function drawTriadHeatmap() {
  const pcs = recognitionNotes === "all" ? [...Array(12).keys()] : naturalPcs;
  const rows = ["major", "minor"].map(quality => `<tr><th>${chordTypes[quality].name}</th>${pcs.map(pc => {
    const chord = { pc, quality };
    const average = triadAverage(chord);
    return `<td class="heat-cell heat-${triadLevel(chord)}"><strong>${triadChordName(chord)}</strong><small>${average === null ? "–" : (average / 1000).toFixed(1)}</small></td>`;
  }).join("")}</tr>`).join("");
  exerciseUI["board-scroll"].innerHTML = `<table class="chord-heat" aria-label="Heatmap of average response times per chord">${rows}</table>`;
  exerciseUI["board-note"].hidden = true;
  exerciseUI["board-chord"].hidden = true;
}

function renderTriad() {
  const question = triadQuestion;
  const chord = question.chord;
  const complete = runCount >= runLength;
  exerciseUI["training-mode-help"].textContent = triadSound()
    ? "Type 3: find the root, then play the three notes of the triad one at a time, muting each before the next. Click New run to start."
    : "Answer with the mouse or the keyboard: C–B keys, H before a letter for a sharp, M before a letter for a minor chord. Click New run to start.";
  exerciseUI["exercise-direction"].hidden = false;
  exerciseUI["exercise-direction"].textContent = triadTypeNames[question.type];
  exerciseUI["requested-string"].hidden = false;
  exerciseUI["note-region"].hidden = true;
  exerciseUI["exercise-title"].className = "";
  exerciseUI["exercise-progress"].max = runLength;
  exerciseUI["exercise-progress"].value = runCount;
  exerciseUI["progress-text"].textContent = `${runCount} / ${runLength} questions`;
  exerciseUI["heatmap-legend"].hidden = !triadHeatmapShown;
  exerciseUI["toggle-heatmap"].textContent = triadHeatmapShown ? "Hide heatmap" : "Heatmap";
  renderTriadScoreboard();
  renderTriadButtons();
  if (!chord) {
    exerciseUI["exercise-title"].textContent = "No triad fits the selected strings";
    exerciseUI["recognition-board"].hidden = true;
    return;
  }
  const name = triadChordName(chord);
  if (triadHeatmapShown) {
    exerciseUI["exercise-title"].textContent = "Heatmap";
    exerciseUI["recognition-board"].hidden = false;
    drawTriadHeatmap();
    return;
  }
  exerciseUI["exercise-title"].textContent = complete ? "Run complete" : "Spell the triad";
  if (question.type === "spell") {
    const spelled = spellTriad(chord);
    exerciseUI["recognition-board"].hidden = true;
    exerciseUI["expected-label"].textContent = "SPELL";
    exerciseUI["expected-note"].innerHTML = `<span class="chord-title chord-${chord.quality}">${name}</span>`;
    exerciseUI["requested-string"].textContent = triadDegrees[chord.quality].map((degree, step) => step < question.step ? spelled[step] : degree).join(" – ");
    exerciseUI["expected-position"].textContent = "Click R, 3 and 5 in that order";
    return;
  }
  exerciseUI["recognition-board"].hidden = false;
  if (question.type === "find") {
    exerciseUI["expected-label"].textContent = "WHICH CHORD?";
    exerciseUI["expected-note"].textContent = "?";
    exerciseUI["requested-string"].textContent = "Root yellow, 3 and 5 purple";
    exerciseUI["expected-position"].textContent = "Click the chord, or press M for minor and its letter";
    // Colours only: names and degrees would give the answer away.
    drawBoard({ string: null, label: "", focusFret: question.root.fret,
      notes: question.voicing.notes.map(note => ({ ...note, name: "", degree: "", kind: note.degree === "R" ? "start" : "chord" })),
      description: "Fretboard with a triad. Which chord is it?" });
    return;
  }
  // Type 3, like Train chord with first note.
  const root = question.root;
  const strings = question.voicing.notes.map(note => note.string);
  const spelled = spellTriad(chord);
  exerciseUI["requested-string"].textContent = stringLabel(GuitarScales.strings.find(row => row.string === root.string));
  if (!question.rootFound) {
    exerciseUI["exercise-title"].textContent = `Find ${triadRootNames[chord.quality][chord.pc]} on string ${root.string}`;
    exerciseUI["expected-label"].textContent = "STARTING ROOT";
    exerciseUI["expected-note"].textContent = triadRootNames[chord.quality][chord.pc];
    exerciseUI["expected-position"].textContent = `Octave ${Math.floor(root.midi / 12) - 1}`;
    drawBoard({ string: root.string, label: pitchLabel(root.midi), frame: question.rootFrame,
      description: `Fretboard. The root is on string ${root.string}, inside the frame: frets ${question.rootFrame.fromFret} to ${question.rootFrame.toFret}.` });
    return;
  }
  exerciseUI["exercise-title"].textContent = name;
  exerciseUI["exercise-title"].className = `chord-title chord-${chord.quality}`;
  exerciseUI["expected-label"].textContent = "PLAY THE TRIAD";
  exerciseUI["expected-note"].textContent = name;
  exerciseUI["expected-position"].textContent = `${question.played.size} / 3 notes · strings ${Math.min(...strings)}–${Math.max(...strings)}`;
  const frets = question.voicing.notes.map(note => note.fret);
  drawBoard({ string: root.string, label: pitchLabel(root.midi), chord: { symbol: name, type: chord.quality },
    frame: { fromFret: Math.min(...frets), toFret: Math.max(...frets), fromString: Math.min(...strings), toString: Math.max(...strings) },
    muted: [1, 2, 3, 4, 5, 6].filter(string => !strings.includes(string)),
    notes: question.voicing.notes.filter(note => question.played.has(note.midi)).map(note => ({
      ...note, name: spelled[note.degree === "R" ? 0 : note.degree === "5" ? 2 : 1],
      kind: note.degree === "R" ? "start" : "chord", played: true })),
    description: `Fretboard. The ${name} triad is inside the frame on strings ${Math.min(...strings)} to ${Math.max(...strings)}.` });
}

function renderTriadScoreboard() {
  const last = triadStats.last;
  exerciseUI["score-last"].textContent = last
    ? `Last run: ${(last.time / 1000).toFixed(1)} s (${(last.average / 1000).toFixed(2)} s/question)`
    : "Last run: —";
  exerciseUI["score-streak"].textContent = `Streak: ${triadStreak} · Best: ${triadStats.bestStreak}`;
  exerciseUI["score-top10"].innerHTML = triadStats.top10.length
    ? triadStats.top10.map(entry => `<li>${formatRunEntry(entry)}</li>`).join("")
    : "<li class=\"score-empty\">No runs yet</li>";
}

// Type 3 excludes types 1 and 2, and the other way round.
function setTriadTypes(types) {
  triadTypes.clear();
  for (const type of types) if (type in triadTypeNames) triadTypes.add(type);
  if (triadTypes.has("play") && triadTypes.size > 1) triadTypes.delete("play");
  if (!triadTypes.size) triadTypes.add("spell");
  for (const type of Object.keys(triadTypeNames)) exerciseUI[`triad-type-${type}`].checked = triadTypes.has(type);
}

function initTriadTrainer() {
  // Answer buttons, keys and Heatmap are wired in initClickTrainer; Reset stats in progress-stats.js.
  loadTriadStats();
  for (const type of Object.keys(triadTypeNames)) {
    exerciseUI[`triad-type-${type}`].addEventListener("change", () => {
      const checkbox = exerciseUI[`triad-type-${type}`];
      if (checkbox.checked) {
        if (type === "play") setTriadTypes(["play"]);
        else setTriadTypes([...triadTypes].filter(other => other !== "play").concat(type));
      } else if (triadTypes.size === 1) {
        checkbox.checked = true;
        return;
      } else {
        setTriadTypes([...triadTypes].filter(other => other !== type));
      }
      if (triadMode()) restartTriadRun();
      saveSettings();
    });
  }
}
