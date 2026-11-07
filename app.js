"use strict";

const elements = Object.fromEntries(
  ["start", "status", "note", "octave", "frequency", "cents",
   "needle", "message", "audio-input", "audio-input-status", "theme"].map(id => [id, document.getElementById(id)])
);

let audioInputs = [];
let activeInputLabel = "";
let inputRefresh = 0;

function showAudioInput() {
  const selected = audioInputs.find(device => device.deviceId === elements["audio-input"].value);
  elements["audio-input-status"].textContent = activeInputLabel
    ? `Using: ${activeInputLabel}. Stop listening to change input.`
    : `Selected: ${selected?.label || "Browser default"}`;
}

async function refreshAudioInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const refresh = ++inputRefresh;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (refresh !== inputRefresh) return;
    const selectedId = elements["audio-input"].value;
    audioInputs = devices.filter(device => device.kind === "audioinput" && device.deviceId)
      .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Audio input ${index + 1}` }));
    // Device labels come from the browser; escape them before adding option markup.
    const escape = value => String(value).replace(/[&<>"']/g, character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
    elements["audio-input"].innerHTML = '<option value="">Browser default</option>' +
      audioInputs.map(device => `<option value="${escape(device.deviceId)}">${escape(device.label)}</option>`).join("");
    // Keep a removed selection visible so the next Start cannot silently use another device.
    if (selectedId && !audioInputs.some(device => device.deviceId === selectedId)) {
      elements["audio-input"].innerHTML += `<option value="${escape(selectedId)}">Previously selected input (unavailable)</option>`;
      audioInputs.push({ deviceId: selectedId, label: "Previously selected input (unavailable)" });
    }
    elements["audio-input"].value = selectedId;
    showAudioInput();
  } catch {
    if (!activeInputLabel) elements["audio-input-status"].textContent = "Device list unavailable. Start listening to request access.";
  }
}

const noteNames = [
  "C", "C♯", "D", "D♯", "E", "F",
  "F♯", "G", "G♯", "A", "A♯", "B"
];

let audioContext;
let microphone;
let source;
let analyser;
let buffer;
let animation;
let listening = false;
let previousNote = null;
let matches = 0;
let candidateSince = null;
let lastDetected = 0;
let lastAnalysis = 0;
let lastTunerAnalysis = 0;

const exerciseUI = Object.fromEntries([
  "exercise-title", "exercise-chord", "scale-notes", "pattern-hint", "expected-label",
  "expected-note", "expected-position", "exercise-direction", "exercise-progress",
  "progress-text", "exercise-result", "played-note", "exercise-feedback", "remaining-notes",
  "new-exercise", "restart-exercise", "reset-clock", "toggle-hint", "exercise-hint",
  "training-mode", "training-mode-help", "legend-scale", "exercise-description",
  "exercise-run-controls", "exercise-run-length", "auto-continue", "exercise-run-status", "next-delay", "next-delay-value",
  "answer-buttons", "toggle-heatmap", "heatmap-legend", "scoreboard", "score-last", "score-streak", "score-top10", "reset-stats",
  "click-types", "click-type-name", "click-type-find", "click-type-nearest", "run-length-label",
  "triad-types", "triad-type-spell", "triad-type-find", "triad-type-play",
  "recognition-controls", "run-length", "run-time", "run-average", "recognition-notes",
  "starting-pitch", "requested-string", "string-selection-help", "note-region",
  "recognition-board", "board-note", "board-chord", "board-scroll", "frame-controls", "frame-frets", "frame-strings", "run-mistakes",
  "settings-frame", "toggle-settings", "settings-summary", "practice-set", "time-limit", "time-limit-value", "time-bar", "time-bar-fill", "show-answer", "listener-card", "mic-note",
  "types-group", "strings-group", "question-heading", "question-count", "answer-area", "answer-heading", "answer-caption",
  "pitch-chips", "board-caption", "stat-tiles", "stat-last", "round-summary", "review-missed", "items-heading", "item-table",
  "chart-accuracy", "chart-time", "time-chart-heading", "mini-heatmap", "mini-heat-caption", "top-fails", "top10-unit", "run-status-line",
  ...[1, 2, 3, 4, 5, 6].map(string => `train-string-${string}`)
].map(id => [id, document.getElementById(id)]));
let exercise;
let startingRoot;
let rootStarted = false;
const playedPitches = new Set();
let heldNote = null;
let quietSince = null;
let previousExerciseNote = null;
let exerciseMatches = 0;
let patternHintTimer = null;
let trainingMode = "full";
let recognitionTarget = null;
let runLength = 10;
let runCount = 0;
let runMistakes = 0;
// Muting a string makes brief stray pitches. In a run, wrong notes are ignored
// shortly after a correct note, and must ring this long before they count.
const mistakeGraceMs = 400;
const mistakeHoldMs = 120;
let lastCorrectAt = null;
let exerciseCandidateSince = null;
let runElapsed = 0;
let runStartedAt = null;
let runTimer = null;
let runActive = false;
// Set when the time limit ends a scale or chord exercise.
let exerciseTimedOut = false;
// A mistake on the current question, note or exercise.
let itemMistake = false;
// Continue automatically: the next exercise (or, in the recognition modes,
// the next run) follows after a short countdown.
let autoContinue = false;
let nextExerciseTimer = null;
let nextExerciseDelay = 3;

// Natural notes only, standard tuning, open strings through fret 15 inclusive.
const recognitionTargets = GuitarScales.strings.flatMap(row =>
  Array.from({ length: 16 }, (_, fret) => ({ ...row, fret, midi: row.open + fret }))
    .filter(target => Object.values(GuitarScales.naturals).includes(target.midi % 12)));
const allRecognitionTargets = GuitarScales.strings.flatMap(row =>
  Array.from({ length: 16 }, (_, fret) => ({ ...row, fret, midi: row.open + fret })));
let recognitionNotes = "natural";
const recognitionStrings = new Set([1, 2, 3, 4, 5, 6]);
// Visual mode: a frame of frets x strings that contains the target somewhere.
let frameFrets = 4;
let frameStrings = 3;
let recognitionFrame = null;
let rootFrame = null;

function recognitionMode() {
  return trainingMode === "recognition-visual";
}

// Modes with questions, a scoreboard and a heatmap: the click and triad modes.
function questionMode() {
  return clickMode() || triadMode();
}

function randomBetween(low, high) {
  return low + Math.floor(Math.random() * (high - low + 1));
}

// Place the frame at a random offset so its position never reveals the target.
// Columns are fret 0 (open string) through 15; rows are strings 1 (top) to 6.
function frameAround(target) {
  const width = Math.min(frameFrets, 16);
  const height = Math.min(frameStrings, 6);
  const fromFret = randomBetween(Math.max(0, target.fret - width + 1), Math.min(target.fret, 16 - width));
  const fromString = randomBetween(Math.max(1, target.string - height + 1), Math.min(target.string, 7 - height));
  return { fromFret, toFret: fromFret + width - 1, fromString, toString: fromString + height - 1 };
}

function chooseRecognitionFrame() {
  recognitionFrame = frameAround(recognitionTarget);
}

// One fretboard for every visual mode: open string through fret 15, high e on top.
// The requested string is coloured, with its label beside the board. A frame and
// note markers (root, chord tone, scale note; ✓ when played) are optional.
function drawBoard({ string: requested, label, chord = null, tag = null, frame = null, notes = [], muted = [], highlightFret = null, clickable = false, focusFret = null, description }) {
  // With a frame, the chord (or the scale name) sits as a tag on top of it,
  // where the eyes already are; the board gets extra room above for it.
  const boardTag = !frame ? null
    : chord ? { text: chord.symbol, sub: chordTypes[chord.type].name, kind: `chord-${chord.type}` }
      : tag ? { text: tag, sub: "", kind: "scale-tag" } : null;
  const left = 34, open = 34, cell = 40, top = boardTag ? 46 : 20, gap = 30;
  const fretX = fret => fret === 0 ? left : left + open + (fret - 1) * cell;
  const cellWidth = fret => fret === 0 ? open : cell;
  const stringY = string => top + (string - 1) * gap;
  const width = left + open + 15 * cell + 6;
  const bottom = stringY(6);
  const names = { 1: "e", 2: "B", 3: "G", 4: "D", 5: "A", 6: "E" };
  const parts = [];
  for (const fret of [3, 5, 7, 9, 15]) parts.push(`<circle class="board-inlay" cx="${fretX(fret) + cell / 2}" cy="${(stringY(3) + stringY(4)) / 2}" r="5"/>`);
  for (const y of [(stringY(2) + stringY(3)) / 2, (stringY(4) + stringY(5)) / 2]) parts.push(`<circle class="board-inlay" cx="${fretX(12) + cell / 2}" cy="${y}" r="5"/>`);
  if (highlightFret !== null) parts.push(`<rect class="board-highlight" x="${fretX(highlightFret) + 2}" y="${top - 12}" width="${cellWidth(highlightFret) - 4}" height="${bottom - top + 24}" rx="6"/>`);
  for (let fret = 1; fret <= 15; fret++) parts.push(`<line class="${fret === 1 ? "board-nut" : "board-fret"}" x1="${fretX(fret)}" y1="${top - 8}" x2="${fretX(fret)}" y2="${bottom + 8}"/>`);
  parts.push(`<line class="board-fret" x1="${width - 6}" y1="${top - 8}" x2="${width - 6}" y2="${bottom + 8}"/>`);
  for (let string = 1; string <= 6; string++) {
    if (string === requested) continue;
    parts.push(`<line class="board-string" x1="${left}" y1="${stringY(string)}" x2="${width - 6}" y2="${stringY(string)}" stroke-width="${0.8 + (string - 1) * 0.3}"/>`);
    parts.push(`<text class="board-label" x="${left - 10}" y="${stringY(string) + 4}" text-anchor="end">${names[string]}</text>`);
  }
  for (let fret = 0; fret <= 15; fret++) parts.push(`<text class="board-label" x="${fretX(fret) + cellWidth(fret) / 2}" y="${bottom + 32}" text-anchor="middle">${fret}</text>`);
  if (frame) {
    const x = fretX(frame.fromFret) + 2;
    const frameWidth = fretX(frame.toFret) + cellWidth(frame.toFret) - 2 - x;
    const y = stringY(frame.fromString) - gap / 2 + 1;
    const frameHeight = stringY(frame.toString) + gap / 2 - 1 - y;
    parts.push(`<rect class="board-frame" x="${x}" y="${y}" width="${frameWidth}" height="${frameHeight}" rx="8"/>`);
  }
  // Draw the requested string after the frame, so it stays coloured on top.
  if (requested) {
    parts.push(`<line class="board-string board-requested" x1="${left}" y1="${stringY(requested)}" x2="${width - 6}" y2="${stringY(requested)}"/>`);
    parts.push(`<text class="board-label board-requested-label" x="${left - 10}" y="${stringY(requested) + 4}" text-anchor="end">${names[requested]}</text>`);
  }
  for (const string of muted) parts.push(`<text class="board-muted" x="${left + open / 2}" y="${stringY(string) + 5}" text-anchor="middle">✕</text>`);
  for (const note of notes) {
    const x = fretX(note.fret) + cellWidth(note.fret) / 2;
    const y = stringY(note.string);
    parts.push(`<g class="board-dot ${note.kind}${note.played ? " played" : ""}"><circle cx="${x}" cy="${y}" r="13"/>` +
      `<text class="dot-name" x="${x}" y="${y}" text-anchor="middle">${note.name}</text>` +
      `<text class="dot-degree" x="${x}" y="${y + 8.5}" text-anchor="middle">${note.degree}</text>` +
      `${note.played ? `<g class="board-check"><circle class="check-dot" cx="${x + 11}" cy="${y - 10}" r="5.5"/><text x="${x + 11}" y="${y - 7.5}" text-anchor="middle">✓</text></g>` : ""}</g>`);
  }
  if (boardTag) {
    const frameLeft = fretX(frame.fromFret), frameRight = fretX(frame.toFret) + cellWidth(frame.toFret);
    const tagWidth = boardTag.text.length * (boardTag.sub ? 12 : 8.5) + boardTag.sub.length * 7 + (boardTag.sub ? 30 : 22);
    const centre = Math.max(left + tagWidth / 2, Math.min(width - 6 - tagWidth / 2, (frameLeft + frameRight) / 2));
    const tagY = stringY(frame.fromString) - gap / 2 + 1 - 27;
    parts.push(`<g class="board-tag ${boardTag.kind}"><rect x="${centre - tagWidth / 2}" y="${tagY}" width="${tagWidth}" height="24" rx="8"/>` +
      `<text x="${centre}" y="${tagY + 17}" text-anchor="middle"><tspan class="tag-main">${boardTag.text}</tspan>` +
      `${boardTag.sub ? `<tspan class="tag-sub" dx="6">${boardTag.sub}</tspan>` : ""}</text></g>`);
  }
  // Clickable cells go on top, one per string and fret.
  if (clickable) {
    for (let string = 1; string <= 6; string++) {
      for (let fret = 0; fret <= 15; fret++) {
        parts.push(`<rect class="board-cell" data-string="${string}" data-fret="${fret}" x="${fretX(fret)}" y="${stringY(string) - gap / 2}" width="${cellWidth(fret)}" height="${gap}"/>`);
      }
    }
  }
  const height = bottom + 40;
  exerciseUI["board-scroll"].innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${description}">${parts.join("")}</svg>`;
  // The note label sits beside the board, level with the requested string.
  // Sharp and flat names go on two lines so the label stays narrow.
  exerciseUI["board-note"].textContent = label.replace(" / ", "\n");
  exerciseUI["board-note"].hidden = !label;
  if (requested) exerciseUI["board-note"].style.top = `${(stringY(requested) / height * 100).toFixed(2)}%`;
  // The chord label sits in the same column, on the half away from the root label.
  // Symbol and type come from chordTypes, so they are safe to insert as HTML.
  const chordLabel = exerciseUI["board-chord"];
  chordLabel.hidden = !chord || Boolean(boardTag);
  chordLabel.className = chord ? `board-chord chord-${chord.type}` : "board-chord";
  chordLabel.innerHTML = chord ? `<span class="chord-symbol">${chord.symbol}</span><span class="chord-type">${chordTypes[chord.type].name}</span>` : "";
  chordLabel.style.top = requested >= 4 ? "4px" : "auto";
  chordLabel.style.bottom = requested >= 4 ? "auto" : "4px";
  // On narrow screens the board scrolls sideways; bring the frame (or one fret) into view.
  const board = exerciseUI["board-scroll"];
  if ((frame || focusFret !== null) && board.scrollWidth > board.clientWidth) {
    const centre = frame
      ? (fretX(frame.fromFret) + fretX(frame.toFret) + cellWidth(frame.toFret)) / 2
      : fretX(focusFret) + cellWidth(focusFret) / 2;
    board.scrollLeft = centre / width * board.scrollWidth - board.clientWidth / 2;
  }
}

function drawRecognitionBoard() {
  const frame = recognitionFrame;
  drawBoard({
    string: recognitionTarget.string,
    label: pitchLabel(recognitionTarget.midi),
    frame,
    description: frame
      ? `Fretboard. The note is on string ${recognitionTarget.string}, inside the frame: frets ${frame.fromFret} to ${frame.toFret}, strings ${frame.fromString} to ${frame.toString}.`
      : "Fretboard"
  });
}

const degreeNames = { 0: "R", 2: "2", 3: "♭3", 4: "3", 5: "4", 7: "5", 9: "6", 10: "♭7" };

// Hint markers, most specific first: the starting note, roots, notes of the
// CAGED chord grip at this position, then the other scale notes. Grip notes
// can lie just outside the scale box, so they are added when missing.
function hintNotes() {
  const marks = new Map();
  for (const note of [...exercise.notes, ...exercise.chordNotes]) {
    const key = `${note.string}-${note.fret}`;
    if (marks.has(key)) continue;
    const inGrip = exercise.chordNotes.some(chord => chord.string === note.string && chord.fret === note.fret);
    const start = note.string === startingRoot.string && note.fret === startingRoot.fret;
    const root = note.midi % 12 === exercise.rootPC;
    marks.set(key, {
      string: note.string,
      fret: note.fret,
      name: exercise.spellings[note.midi % 12],
      degree: degreeNames[(note.midi - exercise.rootPC + 120) % 12],
      kind: start ? "start" : root ? "root" : inGrip ? "chord" : "scale",
      played: playedPitches.has(note.midi)
    });
  }
  return [...marks.values()];
}

// Scale modes: first-note step 1 frames the area around the root; after that
// the pattern frame shows where to explore. Show hint adds every note; without
// it, only the pitches already played appear, so the board shows progress.
function drawScaleBoard() {
  const rootOnly = findingRoot();
  const chord = chordMode();
  const hint = !rootOnly && !exerciseUI["exercise-hint"].hidden;
  const grip = exercise.grip;
  const frame = rootOnly ? rootFrame : chord ? {
    fromFret: Math.min(...grip.map(note => note.fret)), toFret: Math.max(...grip.map(note => note.fret)),
    fromString: Math.min(...grip.map(note => note.string)), toString: Math.max(...grip.map(note => note.string))
  } : { fromFret: exercise.minFret, toFret: exercise.maxFret, fromString: 1, toString: 6 };
  // The chord mode only marks notes of its grip.
  const marks = chord ? hintNotes().filter(mark => grip.some(note => note.string === mark.string && note.fret === mark.fret)) : hintNotes();
  drawBoard({
    string: startingRoot.string,
    label: pitchLabel(startingRoot.midi),
    chord: chord && !rootOnly ? { symbol: chordSymbol(), type: exercise.type } : null,
    tag: chord || rootOnly ? null : `${exercise.root} ${exercise.type} pentatonic`,
    frame,
    notes: hint ? marks : rootOnly ? [] : marks.filter(note => note.played),
    muted: chord && !rootOnly ? exercise.mutedStrings : [],
    description: `Fretboard. Start on string ${startingRoot.string}.` +
      (rootOnly
        ? ` The root is inside the frame: frets ${frame.fromFret} to ${frame.toFret}, strings ${frame.fromString} to ${frame.toString}.`
        : chord
          ? ` The chord shape is inside the frame: frets ${frame.fromFret} to ${frame.toFret}, strings ${frame.fromString} to ${frame.toString}.`
          : ` The pattern is inside the frame: frets ${frame.fromFret} to ${frame.toFret}.`) +
      (hint ? " The hint shows the pattern, the chord shape and the starting note." : playedPitches.size ? " Played notes are shown." : "")
  });
}

function stringLabel(target) {
  return `${target.label}-string (${target.string})`;
}

function recognitionNoteName(midi) {
  return ["C", "C♯ / D♭", "D", "D♯ / E♭", "E", "F", "F♯ / G♭", "G", "G♯ / A♭", "A", "A♯ / B♭", "B"][midi % 12];
}

function chooseRecognitionTarget() {
  // A different pitch prevents a sustained note from answering the next task.
  const targets = recognitionNotes === "all" ? allRecognitionTargets : recognitionTargets;
  let choices = practiceFilter(targets.filter(target => recognitionStrings.has(target.string)), positionItem);
  const fresh = choices.filter(target => target.midi !== recognitionTarget?.midi && target.midi !== heldNote);
  if (fresh.length) choices = fresh;
  recognitionTarget = choices[Math.floor(Math.random() * choices.length)];
  chooseRecognitionFrame();
  startItem(positionItem(recognitionTarget));
}

function readRunLength(id) {
  const requested = Number(exerciseUI[id].value);
  const length = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.round(requested) || 10)) : 10;
  exerciseUI[id].value = String(length);
  return length;
}

function updateRunTime() {
  if (timeLimitReached()) {
    giveUpItem(true);
    return;
  }
  renderStatTiles();
  const elapsed = runElapsed + (runStartedAt === null ? 0 : Date.now() - runStartedAt);
  if (!recognitionMode() && !questionMode()) {
    // Scale and chord modes count exercises; the clock only runs during an exercise.
    const seconds = (elapsed / 1000).toFixed(1);
    exerciseUI["exercise-run-status"].textContent = runCount >= runLength
      ? `Run complete: ${runLength} / ${runLength} · Finished in ${seconds} s · Average: ${(elapsed / 1000 / runLength).toFixed(1)} s/exercise · Mistakes: ${runMistakes}`
      : `Exercise ${Math.max(1, runCount + (exerciseComplete() ? 0 : 1))} / ${runLength} · Time: ${seconds} s · Mistakes: ${runMistakes}`;
    clearTimeout(runTimer);
    runTimer = runStartedAt === null ? null : setTimeout(updateRunTime, 100);
    return;
  }
  exerciseUI["run-time"].textContent = `${runCount === runLength ? "Finished in" : "Time:"} ${(elapsed / 1000).toFixed(1)} s`;
  // Average over the notes found so far, not over the whole run length.
  const unit = questionMode() ? "question" : "note";
  exerciseUI["run-average"].textContent = runCount
    ? `Average: ${(elapsed / 1000 / runCount).toFixed(2)} s/${unit}`
    : `Average: — s/${unit}`;
  exerciseUI["run-mistakes"].textContent = `Mistakes: ${runMistakes}`;
  clearTimeout(runTimer);
  runTimer = runStartedAt === null ? null : setTimeout(updateRunTime, 100);
}

function pauseRunClock() {
  if (runStartedAt !== null) runElapsed += Date.now() - runStartedAt;
  runStartedAt = null;
  clearTimeout(runTimer);
  runTimer = null;
}

function startRunClock() {
  if (!runActive || runCount >= runLength || runStartedAt !== null) return;
  if (!recognitionMode() && !questionMode() && (exerciseComplete() || exerciseTimedOut)) return;
  runStartedAt = Date.now();
  updateRunTime();
}

function cancelNextExercise() {
  clearTimeout(nextExerciseTimer);
  nextExerciseTimer = null;
}

// Keep the finished frame for a few seconds with a countdown, then continue.
function scheduleNext(kind, midi, message, label, seconds = nextExerciseDelay) {
  setExerciseFeedback(kind, midi, `${message} ${label} in ${seconds}…`);
  nextExerciseTimer = setTimeout(() => {
    if (seconds > 1) scheduleNext(kind, midi, message, label, seconds - 1);
    else newExercise();
  }, 1000);
}

// Scale and chord modes: a run of exercises with its own clock and mistakes.
function restartExerciseRun() {
  cancelNextExercise();
  pauseRunClock();
  runActive = true;
  runElapsed = 0;
  runCount = 0;
  runMistakes = 0;
  lastCorrectAt = null;
  runLength = readRunLength("exercise-run-length");
  startRunItems();
  updateRunTime();
}

function restartRecognition(start = false) {
  cancelNextExercise();
  pauseRunClock();
  runActive = start;
  runElapsed = 0;
  runCount = 0;
  runMistakes = 0;
  lastCorrectAt = null;
  runLength = readRunLength("run-length");
  startRunItems();
  chooseRecognitionTarget();
  renderExercise();
  updateRunTime();
  if (listening && start) startRunClock();
  setExerciseFeedback("neutral", null, !start ? "Click New run when ready." : listening ? "Find and play the requested note." : "Start listening to begin the timed run.");
}

function renderRecognition() {
  const complete = runCount >= runLength;
  const name = recognitionNoteName(recognitionTarget.midi);
  exerciseUI["exercise-title"].textContent = complete ? "Run complete" : "Fretboard recognition visual";
  exerciseUI["training-mode-help"].textContent = `${recognitionNotes === "all" ? "All 12 notes" : "Natural notes A–G (C major)"}, open strings through fret 15. Click New run to start. Time pauses when listening stops.`;
  for (const id of ["exercise-chord", "scale-notes", "pattern-hint", "exercise-hint", "toggle-hint"]) exerciseUI[id].hidden = true;
  exerciseUI["expected-label"].textContent = complete ? "LAST NOTE" : "PLAY THIS NOTE";
  exerciseUI["expected-note"].textContent = name;
  // The visual frame replaces the low/high hint.
  exerciseUI["note-region"].hidden = true;
  exerciseUI["frame-controls"].hidden = false;
  exerciseUI["recognition-board"].hidden = false;
  drawRecognitionBoard();
  exerciseUI["requested-string"].textContent = stringLabel(recognitionTarget);
  exerciseUI["expected-position"].textContent = `Octave ${Math.floor(recognitionTarget.midi / 12) - 1}`;
  exerciseUI["exercise-direction"].textContent = complete ? "Run complete" : "Find the note";
  exerciseUI["exercise-progress"].max = runLength;
  exerciseUI["exercise-progress"].value = runCount;
  exerciseUI["progress-text"].textContent = `${runCount} / ${runLength} notes`;
}

function chordMode() {
  return trainingMode === "chord-first";
}

// Chord types for the chord mode. New types (7th chords, …) get a row here
// and their grips in scale-patterns.js and chordModeStrings.
const chordTypes = {
  major: { symbol: "", name: "major" },
  minor: { symbol: "m", name: "minor" }
};

function chordSymbol() {
  return exercise.root + chordTypes[exercise.type].symbol;
}

// Strings played in the chord mode, per chord type and CAGED shape, from
// Tom's chord shape list. Some shapes depend on the starting string; null
// leaves an assignment out of the chord training. Other modes keep the full
// grips from scale-patterns.js.
const chordModeStrings = {
  major: { E: [1, 2, 3, 4, 5, 6], A: [2, 3, 4, 5], C: [2, 3, 4, 5], D: [1, 2, 3], G: { 6: [4, 5, 6], 3: [1, 2, 3, 4], 1: [1, 2, 3, 4] } },
  minor: { E: [1, 2, 3, 4, 5, 6], A: [1, 2, 3, 4, 5], C: { 5: [3, 4, 5], 2: [2, 3, 4] }, D: [1, 2, 3], G: { 6: [4, 5, 6], 3: null, 1: null } }
};

function chordStrings(type, shapeName, startString) {
  const strings = chordModeStrings[type][shapeName];
  return Array.isArray(strings) ? strings : strings[startString] || null;
}

// The chord mode trains an assignment only if its grip is defined and
// includes the starting root's string.
function chordStartPlayed({ type, string, side }) {
  const strings = chordStrings(type, GuitarScales.shapeByStringAndSide[string][side], string);
  return Boolean(strings && strings.includes(string));
}

function findingRoot() {
  return (trainingMode === "root-first" || chordMode()) && !rootStarted;
}

// The notes to play: the scale pattern, or the chord grip in the chord mode.
function targetPitches() {
  return chordMode() ? exercise.gripPitches : exercise.pitches;
}

function schedulePatternHint() {
  if (chordMode()) return;
  clearTimeout(patternHintTimer);
  exerciseUI["pattern-hint"].hidden = true;
  patternHintTimer = setTimeout(() => {
    exerciseUI["pattern-hint"].textContent = `Pattern ${exercise.patternNumber}`;
    exerciseUI["pattern-hint"].hidden = findingRoot();
    patternHintTimer = null;
  }, 5000);
}

function exerciseComplete() {
  return rootStarted && playedPitches.size === targetPitches().size;
}

function analyseExercisePitch(samples, sampleRate, time) {
  const frequency = detectPitch(samples, sampleRate);
  if (!frequency) {
    previousExerciseNote = null;
    exerciseMatches = 0;
    exerciseCandidateSince = null;
    return;
  }
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  if (midi === previousExerciseNote) {
    exerciseMatches++;
  } else {
    previousExerciseNote = midi;
    exerciseMatches = 1;
    exerciseCandidateSince = time;
  }
  if (exerciseMatches >= 2) {
    // Show every confirmed pitch, even when it is wrong for the assignment.
    // The longer tuner window below can refine the frequency/cents afterwards.
    updateTuner(frequency, time);
    handleExerciseNote(midi, time, time - exerciseCandidateSince);
  }
}

function pitchLabel(midi) {
  const octave = Math.floor(midi / 12) - 1;
  // Recognition mode has no scale, so use its own sharp / flat names.
  if (recognitionMode()) {
    return recognitionNoteName(midi).split(" / ").map(name => `${name}${octave}`).join(" / ");
  }
  const name = exercise.spellings[midi % 12] || noteNames[midi % 12];
  return `${name}${octave}`;
}

function setExerciseFeedback(kind, midi, message) {
  exerciseUI["exercise-result"].className = `exercise-result feedback-${kind}`;
  exerciseUI["played-note"].textContent = midi === null ? "" : pitchLabel(midi);
  exerciseUI["exercise-feedback"].textContent = message;
}

// Shows or hides the parts of the page that depend on the mode, then the
// mode's own view and the stats panels.
function renderExercise() {
  const scales = !recognitionMode() && !questionMode();
  const noMicrophone = clickMode() || (triadMode() && !triadSound());
  exerciseUI["listener-card"].hidden = noMicrophone;
  exerciseUI["mic-note"].hidden = !noMicrophone;
  exerciseUI["types-group"].hidden = !questionMode();
  exerciseUI["strings-group"].hidden = scales;
  exerciseUI["show-answer"].hidden = scales;
  exerciseUI["show-answer"].disabled = !runActive || runCount >= runLength;
  exerciseUI["run-status-line"].hidden = scales;
  exerciseUI["question-heading"].textContent = scales ? "Exercise" : recognitionMode() ? "Find the note" : "Question";
  exerciseUI["pitch-chips"].hidden = true;
  exerciseUI["answer-area"].hidden = false;
  renderExerciseView();
  renderAnswerArea();
  renderProgress();
  renderSettingsFrame();
}

function renderAnswerArea() {
  const board = { "recognition-visual": "the requested string is coloured · the frame holds the note", "recognition-click": "click a position or use the answer grid",
    triads: "root yellow, 3 and 5 purple" }[trainingMode] || (chordMode() ? "play the chord shape one note at a time" : "start note amber · roots · played notes · Show hint for the pattern");
  exerciseUI["board-caption"].textContent = board;
  if (questionMode()) {
    exerciseUI["answer-heading"].textContent = "Answer grid";
    exerciseUI["answer-caption"].textContent = triadMode()
      ? "keys C–B, H before a letter for a sharp, M for minor"
      : "keys C–B, H before a letter for a sharp";
    exerciseUI["answer-area"].hidden = exerciseUI["answer-buttons"].hidden;
    return;
  }
  if (recognitionMode() || findingRoot()) {
    exerciseUI["answer-area"].hidden = true;
    return;
  }
  // Scale and chord modes: the pitches of the pattern, ticked when played.
  const targets = [...targetPitches()].sort((a, b) => a - b);
  exerciseUI["answer-heading"].textContent = "Still to play";
  exerciseUI["answer-caption"].textContent = `${targets.length - playedPitches.size} left · pitch and octave`;
  exerciseUI["pitch-chips"].hidden = false;
  exerciseUI["pitch-chips"].innerHTML = targets.map(midi => playedPitches.has(midi)
    ? `<span class="pitch done">✓ ${pitchLabel(midi)}</span>` : `<span class="pitch">${pitchLabel(midi)}</span>`).join("");
}

function renderExerciseView() {
  const click = questionMode();
  const recognition = recognitionMode() || click;
  exerciseUI["restart-exercise"].hidden = recognition;
  exerciseUI["reset-clock"].hidden = !recognition;
  exerciseUI["note-region"].hidden = !recognition;
  exerciseUI["starting-pitch"].className = recognition ? "starting-pitch request-panel recognition-request" : "starting-pitch request-panel";
  exerciseUI["exercise-direction"].hidden = recognition;
  exerciseUI["requested-string"].hidden = false;
  exerciseUI["recognition-controls"].hidden = !recognition;
  exerciseUI["click-types"].hidden = !clickMode();
  exerciseUI["triad-types"].hidden = !triadMode();
  exerciseUI["toggle-heatmap"].hidden = !click;
  exerciseUI["answer-buttons"].hidden = true;
  exerciseUI["heatmap-legend"].hidden = true;
  exerciseUI["run-length-label"].textContent = click ? "Questions per run" : "Notes per run";
  exerciseUI["exercise-run-controls"].hidden = recognition;
  exerciseUI["exercise-run-status"].hidden = recognition;
  exerciseUI["new-exercise"].textContent = recognition || !runActive ? "New run" : "New exercise";
  exerciseUI["restart-exercise"].textContent = recognition ? "Restart run" : "Restart exercise";
  exerciseUI["toggle-hint"].hidden = false;
  exerciseUI["recognition-board"].hidden = true;
  if (click) {
    for (const id of ["exercise-chord", "scale-notes", "pattern-hint", "exercise-hint", "toggle-hint"]) exerciseUI[id].hidden = true;
    exerciseUI["frame-controls"].hidden = false;
    exerciseUI["recognition-board"].hidden = false;
    if (triadMode()) renderTriad();
    else renderClick();
    return;
  }
  if (recognitionMode()) {
    renderRecognition();
    return;
  }
  const complete = exerciseComplete();
  const chord = chordMode();
  const targets = targetPitches();
  exerciseUI["recognition-board"].hidden = false;
  const chordName = chordSymbol();
  const chordTones = exercise.chordPitches.map(pc => exercise.spellings[pc]).join(" – ");
  const gripStrings = exercise.mutedStrings.length ? [1, 2, 3, 4, 5, 6].filter(row => !exercise.mutedStrings.includes(row)) : [1, 6];
  // The chord mode names the chord but not the shape: finding it is the exercise.
  exerciseUI["exercise-title"].textContent = chord ? chordName : `${exercise.root} ${exercise.type} pentatonic`;
  exerciseUI["exercise-title"].className = chord && !findingRoot() ? `chord-title chord-${exercise.type}` : "";
  exerciseUI["exercise-chord"].textContent = chord
    ? `Chord tones: ${chordTones} · Strings ${Math.min(...gripStrings)}–${Math.max(...gripStrings)}`
    : `Chord: ${chordName} · CAGED ${exercise.shapeName} shape · Chord tones: ${chordTones}`;
  exerciseUI["scale-notes"].textContent = `Scale notes: ${exercise.scaleNames.join(" · ")}`;
  exerciseUI["exercise-progress"].max = targets.size;
  exerciseUI["exercise-progress"].value = playedPitches.size;
  exerciseUI["progress-text"].textContent = `${playedPitches.size} / ${targets.size} ${chord ? "chord notes" : "distinct pitches"}`;
  exerciseUI["exercise-direction"].textContent = complete ? "Exercise complete" : rootStarted ? (chord ? "One note at a time, mute it before the next" : "Explore in any order") : "Start on the root";
  exerciseUI["expected-label"].textContent = rootStarted ? "STARTING ROOT PLAYED" : "STARTING ROOT";
  exerciseUI["expected-note"].textContent = exercise.root;
  exerciseUI["note-region"].textContent = startingRoot.fret < 12 ? "low" : "high";
  exerciseUI["requested-string"].textContent = stringLabel(startingRoot);
  exerciseUI["expected-position"].textContent = `Fret ${startingRoot.fret} · Octave ${Math.floor(startingRoot.midi / 12) - 1}`;
  exerciseUI["remaining-notes"].textContent = complete ? `Every pitch in this ${chord ? "chord shape" : "pattern"} has been played.` :
    `Still to play: ${[...targets].filter(midi => !playedPitches.has(midi)).sort((a, b) => a - b).map(pitchLabel).join(" · ")}`;
  const rootOnly = findingRoot();
  exerciseUI["exercise-chord"].hidden = rootOnly;
  exerciseUI["scale-notes"].hidden = rootOnly || chord;
  exerciseUI["legend-scale"].hidden = chord;
  exerciseUI["exercise-description"].textContent = `Complete the exercise by playing every distinct pitch in the ${chord ? "chord shape" : "pattern"}, including its octave. Repeats are allowed. The microphone checks pitch and octave only; string and fret are playing instructions.`;
  exerciseUI["training-mode-help"].textContent = chord
    ? "Find and play the root first. Then the chord shape appears: play its notes in any order, one at a time, and mute each note before the next one. Notes that ring together can't be recognised. Changing mode restarts this exercise."
    : trainingMode === "root-first"
      ? "Find and play the root first. Then the scale and its pattern frame appear. Changing mode restarts this exercise."
      : "The frame shows where the pattern lies. Show hint adds its notes. Changing mode restarts this exercise.";
  exerciseUI["toggle-hint"].disabled = rootOnly;
  if (rootOnly) {
    exerciseUI["exercise-title"].textContent = `Find ${exercise.root} on string ${startingRoot.string}`;
    exerciseUI["expected-position"].textContent = `Octave ${Math.floor(startingRoot.midi / 12) - 1}`;
    exerciseUI["progress-text"].textContent = "Step 1: Find and play the root";
    exerciseUI["exercise-progress"].max = 1;
    exerciseUI["exercise-progress"].value = 0;
    exerciseUI["exercise-hint"].hidden = true;
    exerciseUI["toggle-hint"].textContent = "Show hint";
    exerciseUI["toggle-hint"].setAttribute("aria-expanded", "false");
    exerciseUI["pattern-hint"].hidden = true;
  }
  drawScaleBoard();
}

function configureExercise({ root, string, side, type }) {
  clearTimeout(patternHintTimer);
  patternHintTimer = null;
  exerciseUI["pattern-hint"].hidden = true;
  exerciseUI["pattern-hint"].textContent = "";
  exercise = GuitarScales.buildAssignment(root, string, side, type);
  startingRoot = exercise.startingRoot;
  const gripStrings = chordStrings(type, exercise.shapeName, string) || [];
  exercise.grip = exercise.chordNotes.filter(note => gripStrings.includes(note.string));
  exercise.gripPitches = new Set(exercise.grip.map(note => note.midi));
  exercise.mutedStrings = [1, 2, 3, 4, 5, 6].filter(row => !gripStrings.includes(row));
  restartExercise();
}

function restartExercise() {
  if (clickMode()) {
    restartClickRun();
    return;
  }
  if (triadMode()) {
    restartTriadRun();
    return;
  }
  if (recognitionMode()) {
    restartRecognition();
    return;
  }
  cancelNextExercise();
  if (trainingMode === "root-first" || chordMode()) {
    clearTimeout(patternHintTimer);
    patternHintTimer = null;
    exerciseUI["pattern-hint"].textContent = "";
  }
  rootStarted = false;
  exerciseTimedOut = false;
  playedPitches.clear();
  previousExerciseNote = null;
  exerciseMatches = 0;
  rootFrame = frameAround(startingRoot);
  startItem(exerciseItem({ root: exercise.root, type: exercise.type, string: exercise.startingString, side: exercise.side }));
  // Keep heldNote: selecting/restarting while a note rings must not count it.
  renderExercise();
  if (listening) startRunClock();
  updateRunTime();
  setExerciseFeedback("neutral", null, listening
    ? `Mute the strings, then start on ${pitchLabel(startingRoot.midi)}.`
    : `Start listening, then play ${pitchLabel(startingRoot.midi)}.`);
}

// time and heldFor come from the audio loop; direct calls skip the mistake filter.
function handleExerciseNote(midi, time = null, heldFor = Infinity) {
  if (!listening || midi === heldNote || clickMode()) return;
  if (triadMode()) {
    handleTriadNote(midi, time, heldFor);
    return;
  }
  // During the countdown the finished frame stays; notes are not judged.
  if (nextExerciseTimer !== null) return;
  if (exerciseTimedOut && !recognitionMode()) return;
  const wrong = recognitionMode()
    ? runCount < runLength && midi !== recognitionTarget.midi
    : !exerciseComplete() && (rootStarted ? !targetPitches().has(midi) : midi !== startingRoot.midi);
  if (runActive && wrong && time !== null) {
    // Leave heldNote unchanged, so a wrong note that keeps ringing is checked again.
    if (lastCorrectAt !== null && time - lastCorrectAt < mistakeGraceMs) return;
    if (heldFor < mistakeHoldMs) return;
  }
  heldNote = midi;
  if (recognitionMode()) {
    if (!runActive) return;
    if (runCount >= runLength) return;
    if (midi !== recognitionTarget.midi) {
      // heldNote already stops a ringing wrong note from counting twice.
      runMistakes++;
      itemMistake = true;
      updateRunTime();
      setExerciseFeedback("error", midi, "Try again. Match the requested note and octave.");
      return;
    }
    recordItem(currentItem, { ok: !itemMistake, time: itemElapsed() });
    runCount++;
    lastCorrectAt = time;
    if (runCount === runLength) {
      pauseRunClock();
      runActive = false;
      recordRun();
      updateRunTime();
      const summary = `Run complete in ${(runElapsed / 1000).toFixed(1)} s with ${runMistakes} ${runMistakes === 1 ? "mistake" : "mistakes"}!`;
      if (autoContinue) scheduleNext("run-complete", midi, summary, "Next run");
      else setExerciseFeedback("run-complete", midi, `${summary} Choose New run to try again.`);
    } else {
      chooseRecognitionTarget();
      setExerciseFeedback("correct", midi, "Correct! Find the next note.");
    }
    renderExercise();
    return;
  }
  // A wrong note during an unfinished exercise counts as a run mistake.
  if (wrong && runActive) {
    runMistakes++;
    itemMistake = true;
    updateRunTime();
  }
  if (!rootStarted && midi !== startingRoot.midi) {
    if (findingRoot()) {
      setExerciseFeedback("error", midi, `Find ${pitchLabel(startingRoot.midi)} on string ${startingRoot.string}. Check the octave too.`);
      return;
    }
    setExerciseFeedback("error", midi, `Start on ${pitchLabel(startingRoot.midi)} · String ${startingRoot.string} · Fret ${startingRoot.fret}. Check the octave too.`);
    return;
  }
  const chord = chordMode();
  const chordName = chordSymbol();
  if (!(chord ? exercise.chordClasses : exercise.pitchClasses).has(midi % 12)) {
    setExerciseFeedback("error", midi, chord ? `Not in the ${chordName} chord.` : `Outside ${exercise.root} ${exercise.type} pentatonic.`);
    return;
  }
  if (!targetPitches().has(midi)) {
    setExerciseFeedback("error", midi, chord
      ? "In this chord, but not in this shape / octave. Play a note of the chord shape."
      : "In this scale, but outside this pattern / octave. Play a pitch shown in the hint.");
    return;
  }
  const repeated = playedPitches.has(midi);
  const revealAssignment = findingRoot();
  rootStarted = true;
  playedPitches.add(midi);
  lastCorrectAt = time;
  renderExercise();
  if (revealAssignment) schedulePatternHint();
  const shape = chord ? "chord shape" : "pattern";
  if (!repeated && exerciseComplete()) {
    finishExercise(midi, `✓ Well done! You played every pitch in this ${shape}.`);
    return;
  }
  setExerciseFeedback("correct", midi, exerciseComplete()
    ? `Well done! You played every pitch in this ${shape}. Choose New exercise or Restart exercise.`
    : repeated ? `Correct. This pitch has already been played; try another note in the ${shape}.`
      : revealAssignment
        ? chord ? "Root found! Now play the notes of the chord shape in any order." : "Root found! Now explore the revealed scale and pattern frame in any order."
        : `Correct. Play ${chord ? "another note of the chord shape" : "any note in the pattern"}.`);
}

function finishExercise(midi, message) {
  pauseRunClock();
  if (!runActive) {
    setExerciseFeedback("complete", midi, `${message} Choose New run or Restart exercise.`);
    return;
  }
  recordItem(currentItem, { ok: !itemMistake, time: itemElapsed() });
  runCount++;
  if (runCount >= runLength) {
    runActive = false;
    recordRun();
    updateRunTime();
    renderExercise();
    const seconds = (runElapsed / 1000).toFixed(1);
    setExerciseFeedback("run-complete", midi, `✓ Run complete! ${runLength} ${runLength === 1 ? "exercise" : "exercises"} in ${seconds} s with ${runMistakes} ${runMistakes === 1 ? "mistake" : "mistakes"}. Choose New run to start again.`);
    return;
  }
  updateRunTime();
  if (autoContinue) scheduleNext("complete", midi, message, "Next exercise");
  else setExerciseFeedback("complete", midi, `${message} Choose New exercise or Restart exercise.`);
}

function newExercise() {
  if (clickMode()) { restartClickRun(true); return; }
  if (triadMode()) { restartTriadRun(true); return; }
  if (recognitionMode()) { restartRecognition(true); return; }
  if (!runActive) restartExerciseRun();
  const current = `${exercise.root}-${exercise.startingString}-${exercise.side}-${exercise.type}`;
  const choices = Object.keys(GuitarScales.naturals).flatMap(root => ["major", "minor"].flatMap(type =>
    GuitarScales.strings.flatMap(row => ["left", "right"].map(side =>
      ({ root, type, string: row.string, side }))))).filter(choice =>
      `${choice.root}-${choice.string}-${choice.side}-${choice.type}` !== current &&
      (!chordMode() || chordStartPlayed(choice)));
  const pool = practiceFilter(choices, exerciseItem);
  const choice = pool[Math.floor(Math.random() * pool.length)];
  configureExercise(choice);
  if (!findingRoot()) schedulePatternHint();
}

// A new run in any mode, also used by Review missed.
function newRun() {
  if (clickMode()) restartClickRun(true);
  else if (triadMode()) restartTriadRun(true);
  else if (recognitionMode()) restartRecognition(true);
  else {
    restartExerciseRun();
    newExercise();
  }
}

// Show answer, or the time limit: the item counts as missed and the run goes on.
function giveUpItem(timeout) {
  if (clickMode()) clickGiveUp(timeout);
  else if (triadMode()) triadGiveUp(timeout);
  else if (recognitionMode()) recognitionGiveUp(timeout);
  else if (timeout) exerciseTimeout();
}

function recognitionGiveUp(timeout) {
  if (!runActive || runCount >= runLength || nextExerciseTimer !== null) return;
  const answer = `${pitchLabel(recognitionTarget.midi)} at fret ${recognitionTarget.fret}`;
  runMistakes++;
  recordItem(currentItem, { ok: false, time: itemElapsed(), timeout });
  runCount++;
  const reason = timeout ? "Time's up!" : "Answer:";
  if (runCount === runLength) {
    pauseRunClock();
    runActive = false;
    recordRun();
    updateRunTime();
    renderExercise();
    setExerciseFeedback("run-complete", null, `${reason} It was ${answer}. Run complete with ${runMistakes} ${runMistakes === 1 ? "mistake" : "mistakes"}. Choose New run to try again.`);
    return;
  }
  chooseRecognitionTarget();
  renderExercise();
  updateRunTime();
  setExerciseFeedback("error", null, `${reason} It was ${answer}. Find the next note.`);
}

// Scale and chord modes: time is up, so the exercise ends and its hint is shown.
function exerciseTimeout() {
  if (!runActive || exerciseComplete() || exerciseTimedOut) return;
  pauseRunClock();
  exerciseTimedOut = true;
  runMistakes++;
  recordItem(currentItem, { ok: false, time: itemElapsed(), timeout: true });
  runCount++;
  if (!chordMode() || !findingRoot()) {
    exerciseUI["exercise-hint"].hidden = false;
    exerciseUI["toggle-hint"].textContent = "Hide hint";
    exerciseUI["toggle-hint"].setAttribute("aria-expanded", "true");
  }
  if (runCount >= runLength) {
    runActive = false;
    recordRun();
    updateRunTime();
    renderExercise();
    setExerciseFeedback("run-complete", null, `Time's up! Run complete with ${runMistakes} ${runMistakes === 1 ? "mistake" : "mistakes"}. Choose New run to start again.`);
    return;
  }
  updateRunTime();
  renderExercise();
  if (autoContinue) scheduleNext("error", null, "Time's up!", "Next exercise");
  else setExerciseFeedback("error", null, "Time's up! The hint shows the pattern. Choose New exercise or Restart exercise.");
}

// Release only after real quiet, not just a failed pitch estimate.
function updateExerciseRelease(samples, time) {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  if (Math.sqrt(energy / samples.length) < 0.008) {
    if (quietSince === null) quietSince = time;
    if (time - quietSince >= 200) heldNote = null;
  } else {
    quietSince = null;
  }
}

exerciseUI["restart-exercise"].addEventListener("click", restartExercise);
exerciseUI["new-exercise"].addEventListener("click", newExercise);
exerciseUI["toggle-hint"].addEventListener("click", () => {
  if (recognitionMode() || questionMode()) return;
  if (findingRoot() && !exerciseTimedOut) return;
  const show = exerciseUI["exercise-hint"].hidden;
  exerciseUI["exercise-hint"].hidden = !show;
  exerciseUI["toggle-hint"].textContent = show ? "Hide hint" : "Show hint";
  exerciseUI["toggle-hint"].setAttribute("aria-expanded", String(show));
  drawScaleBoard();
});
exerciseUI["training-mode"].addEventListener("change", () => {
  pauseRunClock();
  trainingMode = ["root-first", "chord-first", "recognition-visual", "recognition-click", "triads"].includes(exerciseUI["training-mode"].value) ? exerciseUI["training-mode"].value : "full";
  clearTimeout(patternHintTimer);
  patternHintTimer = null;
  exerciseUI["pattern-hint"].hidden = true;
  cancelNextExercise();
  if (!recognitionMode() && !questionMode()) restartExerciseRun();
  // Keep the assignment if the chord mode can use it, otherwise take the other side.
  if (chordMode() && !chordStartPlayed({ type: exercise.type, string: exercise.startingString, side: exercise.side })) {
    configureExercise({ root: exercise.root, type: exercise.type, string: exercise.startingString, side: exercise.side === "left" ? "right" : "left" });
  } else {
    restartExercise();
  }
  saveSettings();
});
exerciseUI["run-length"].addEventListener("change", () => {
  if (recognitionMode()) restartRecognition();
  if (clickMode()) restartClickRun();
  if (triadMode()) restartTriadRun();
  saveSettings();
});
exerciseUI["exercise-run-length"].addEventListener("change", () => {
  if (!recognitionMode() && !questionMode()) {
    restartExerciseRun();
    restartExercise();
  } else {
    readRunLength("exercise-run-length");
  }
  saveSettings();
});
function setNextDelay(seconds) {
  nextExerciseDelay = seconds;
  exerciseUI["next-delay"].value = String(seconds);
  exerciseUI["next-delay-value"].textContent = `${seconds} s`;
}

exerciseUI["next-delay"].addEventListener("input", () => {
  const seconds = Math.round(Number(exerciseUI["next-delay"].value));
  setNextDelay(Number.isFinite(seconds) ? Math.max(1, Math.min(10, seconds)) : 3);
});
exerciseUI["next-delay"].addEventListener("change", saveSettings);
exerciseUI["auto-continue"].addEventListener("change", () => {
  autoContinue = exerciseUI["auto-continue"].checked;
  if (!autoContinue) cancelNextExercise();
  saveSettings();
});
for (const id of ["frame-frets", "frame-strings"]) {
  exerciseUI[id].addEventListener("change", () => {
    const limit = id === "frame-frets" ? 16 : 6;
    const requested = Math.round(Number(exerciseUI[id].value));
    const size = Number.isFinite(requested) ? Math.max(1, Math.min(limit, requested)) : (id === "frame-frets" ? 4 : 3);
    exerciseUI[id].value = String(size);
    if (id === "frame-frets") frameFrets = size;
    else frameStrings = size;
    // Only the frame changes; the run and its clock continue.
    if (recognitionTarget) chooseRecognitionFrame();
    if (recognitionMode()) renderExercise();
    saveSettings();
  });
}
exerciseUI["reset-clock"].addEventListener("click", () => {
  if (questionMode()) {
    restartExercise();
    setExerciseFeedback("neutral", null, "Clock reset. Click New run when ready.");
    return;
  }
  if (!recognitionMode()) return;
  pauseRunClock();
  runActive = false;
  runElapsed = 0;
  runCount = 0;
  runMistakes = 0;
  updateRunTime();
  renderExercise();
  setExerciseFeedback("neutral", null, "Clock reset. Click New run when ready.");
});
exerciseUI["recognition-notes"].addEventListener("change", () => {
  recognitionNotes = exerciseUI["recognition-notes"].value === "all" ? "all" : "natural";
  if (recognitionMode()) restartRecognition();
  if (questionMode()) restartExercise();
  saveSettings();
});
for (const string of [1, 2, 3, 4, 5, 6]) {
  exerciseUI[`train-string-${string}`].addEventListener("change", () => {
    const checkbox = exerciseUI[`train-string-${string}`];
    if (!checkbox.checked && recognitionStrings.size === 1 && recognitionStrings.has(string)) {
      checkbox.checked = true;
      exerciseUI["string-selection-help"].textContent = "Keep at least one string selected.";
      return;
    }
    if (checkbox.checked) recognitionStrings.add(string);
    else recognitionStrings.delete(string);
    exerciseUI["string-selection-help"].textContent = "Select at least one string. Click New run when ready.";
    if (recognitionMode()) restartRecognition();
    if (questionMode()) restartExercise();
    saveSettings();
  });
}
elements.theme.addEventListener("change", () => {
  document.documentElement.setAttribute("data-theme", elements.theme.value === "neon" ? "neon" : "classic");
  saveSettings();
});

// Settings stay in this browser only. Storage can be blocked or hold bad data,
// so every read and write falls back silently to the defaults.
const settingsKey = "guitar-trainer-settings";

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey));
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

// The Settings frame folds away to a one-line summary, to give the training
// more room. Start listening lives in the Listening strip, so it stays reachable.
let settingsCollapsed = false;
const modeNames = { full: "Train scales", "root-first": "Train scales with first note", "chord-first": "Train chord with first note",
  "recognition-visual": "Fretboard recognition visual", "recognition-click": "Fretboard recognition click", triads: "Spell the triad" };

function settingsSummary() {
  const scales = !recognitionMode() && !questionMode();
  const parts = [modeNames[trainingMode] || trainingMode,
    { all: "All", weakest: "Weakest 5", missed: "Missed in last run" }[practiceSet] || "All",
    `${scales ? exerciseUI["exercise-run-length"].value : exerciseUI["run-length"].value} per run`,
    autoContinue ? `auto ${nextExerciseDelay} s` : "manual next",
    timeLimit ? `limit ${timeLimit} s` : "no time limit"];
  return parts.join(" · ");
}

function renderSettingsFrame() {
  exerciseUI["settings-frame"].className = `card settings-frame${settingsCollapsed ? " collapsed" : ""}`;
  exerciseUI["toggle-settings"].textContent = settingsCollapsed ? "▸ Settings" : "▾ Settings";
  exerciseUI["toggle-settings"].setAttribute("aria-expanded", String(!settingsCollapsed));
  exerciseUI["settings-summary"].textContent = settingsSummary();
  exerciseUI["settings-summary"].hidden = !settingsCollapsed;
}

exerciseUI["toggle-settings"].addEventListener("click", () => {
  settingsCollapsed = !settingsCollapsed;
  saveSettings();
});

function saveSettings() {
  renderSettingsFrame();
  try {
    localStorage.setItem(settingsKey, JSON.stringify({
      theme: elements.theme.value === "neon" ? "neon" : "classic",
      trainingMode,
      runLength: Number(exerciseUI["run-length"].value),
      exerciseRunLength: Number(exerciseUI["exercise-run-length"].value),
      autoContinue,
      nextDelay: nextExerciseDelay,
      clickTypes: [...clickTypes],
      triadTypes: [...triadTypes],
      recognitionNotes,
      frameFrets,
      frameStrings,
      practiceSet,
      timeLimit,
      settingsCollapsed,
      strings: [...recognitionStrings].sort((a, b) => a - b)
    }));
  } catch {
    // Not saving is harmless: the trainer still works with the current settings.
  }
}

function restoreSettings() {
  const saved = loadSettings();
  // Dark neon is the default; Classic green only when it was chosen.
  const theme = saved.theme === "classic" ? "classic" : "neon";
  elements.theme.value = theme;
  document.documentElement?.setAttribute("data-theme", theme);
  setPracticeSet(saved.practiceSet);
  if (Number.isInteger(saved.timeLimit) && saved.timeLimit >= 0 && saved.timeLimit <= 60 && saved.timeLimit % 5 === 0) setTimeLimit(saved.timeLimit);
  settingsCollapsed = saved.settingsCollapsed === true;
  renderSettingsFrame();
  // The plain Fretboard recognition mode was removed; its visual version replaces it.
  if (saved.trainingMode === "recognition") saved.trainingMode = "recognition-visual";
  if (["full", "root-first", "chord-first", "recognition-visual", "recognition-click", "triads"].includes(saved.trainingMode)) {
    trainingMode = saved.trainingMode;
    exerciseUI["training-mode"].value = trainingMode;
  }
  if (Number.isInteger(saved.runLength) && saved.runLength >= 1 && saved.runLength <= 100) {
    exerciseUI["run-length"].value = String(saved.runLength);
  }
  if (Number.isInteger(saved.exerciseRunLength) && saved.exerciseRunLength >= 1 && saved.exerciseRunLength <= 100) {
    exerciseUI["exercise-run-length"].value = String(saved.exerciseRunLength);
  }
  if (Array.isArray(saved.clickTypes)) setClickTypes(saved.clickTypes);
  if (Array.isArray(saved.triadTypes)) setTriadTypes(saved.triadTypes);
  if (Number.isInteger(saved.nextDelay) && saved.nextDelay >= 1 && saved.nextDelay <= 10) setNextDelay(saved.nextDelay);
  if (saved.autoContinue === true) {
    autoContinue = true;
    exerciseUI["auto-continue"].checked = true;
  }
  if (Number.isInteger(saved.frameFrets) && saved.frameFrets >= 1 && saved.frameFrets <= 16) {
    frameFrets = saved.frameFrets;
    exerciseUI["frame-frets"].value = String(frameFrets);
  }
  if (Number.isInteger(saved.frameStrings) && saved.frameStrings >= 1 && saved.frameStrings <= 6) {
    frameStrings = saved.frameStrings;
    exerciseUI["frame-strings"].value = String(frameStrings);
  }
  if (saved.recognitionNotes === "all") {
    recognitionNotes = "all";
    exerciseUI["recognition-notes"].value = "all";
  }
  const strings = Array.isArray(saved.strings) ? saved.strings.filter(string => [1, 2, 3, 4, 5, 6].includes(string)) : [];
  if (strings.length) {
    recognitionStrings.clear();
    for (const string of [1, 2, 3, 4, 5, 6]) {
      exerciseUI[`train-string-${string}`].checked = strings.includes(string);
      if (strings.includes(string)) recognitionStrings.add(string);
    }
  }
}

initClickTrainer();
initTriadTrainer();
initProgress();
restoreSettings();
restartExerciseRun();
configureExercise({ root: "A", string: 6, side: "right", type: "minor" });

// YIN-style periodicity detection for a single musical note.
function detectPitch(samples, sampleRate) {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;

  // Ignore very quiet input.
  if (Math.sqrt(energy / samples.length) < 0.008) return null;

  const minimumLag = Math.floor(sampleRate / 1400);
  const maximumLag = Math.min(
    Math.floor(sampleRate / 65),
    Math.floor(samples.length / 2) - 1
  );

  const windowLength = samples.length - maximumLag;
  const differences = new Float32Array(maximumLag + 1);
  let accumulated = 0;

  for (let lag = 1; lag <= maximumLag; lag++) {
    let difference = 0;

    for (let i = 0; i < windowLength; i++) {
      const delta = samples[i] - samples[i + lag];
      difference += delta * delta;
    }

    accumulated += difference;
    differences[lag] = accumulated
      ? difference * lag / accumulated
      : 1;
  }

  for (let lag = minimumLag; lag < maximumLag; lag++) {
    if (differences[lag] >= 0.12) continue;

    while (
      lag + 1 < maximumLag &&
      differences[lag + 1] < differences[lag]
    ) {
      lag++;
    }

    const left = differences[lag - 1];
    const middle = differences[lag];
    const right = differences[lag + 1];
    const denominator = 2 * (2 * middle - left - right);
    const refinedLag = denominator
      ? lag + (right - left) / denominator
      : lag;

    return sampleRate / refinedLag;
  }

  return null;
}

function clearDisplay() {
  elements.note.textContent = "—";
  elements.octave.textContent = "Waiting for a note";
  elements.frequency.textContent = "— Hz";
  elements.cents.textContent = "— cents";
  elements.needle.hidden = true;
}

function updateTuner(frequency, time, stable = false) {
  const preciseNote = 69 + 12 * Math.log2(frequency / 440);
  const midiNote = Math.round(preciseNote);
  const cents = Math.round((preciseNote - midiNote) * 100);
  elements.note.textContent = noteNames[midiNote % 12];
  elements.octave.textContent = `Octave ${Math.floor(midiNote / 12) - 1}`;
  elements.frequency.textContent = `${frequency.toFixed(1)} Hz`;
  elements.cents.textContent = `${cents > 0 ? "+" : ""}${cents} cents`;
  elements.needle.hidden = false;
  elements.needle.style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
  elements.status.textContent = stable
    ? Math.abs(cents) <= 10 ? "Stable note · in tune" : "Stable note detected"
    : "Note detected";
  lastDetected = time;
}

function analyse(time) {
  if (!listening) return;

  // At 60 Hz, a 20 ms limit skipped every other animation frame. Use each
  // frame and only the most recent 25 ms for the exercise.
  // Keep the full buffer and slower stability checks for the open-string tuner.
  if (time - lastAnalysis >= 12) {
    lastAnalysis = time;
    analyser.getFloatTimeDomainData(buffer);
    const exerciseLength = Math.min(buffer.length, Math.ceil(audioContext.sampleRate * 0.025));
    const recentSamples = buffer.subarray(buffer.length - exerciseLength);
    updateExerciseRelease(recentSamples, time);
    analyseExercisePitch(recentSamples, audioContext.sampleRate, time);
  }

  if (time - lastTunerAnalysis >= 40) {
    lastTunerAnalysis = time;
    const frequency = detectPitch(buffer, audioContext.sampleRate);

    if (frequency) {
      const preciseNote = 69 + 12 * Math.log2(frequency / 440);
      const midiNote = Math.round(preciseNote);

      if (midiNote === previousNote) {
        matches++;
      } else {
        previousNote = midiNote;
        matches = 1;
        candidateSince = time;
      }

      if (matches >= 3 && time - candidateSince >= 80) {
        updateTuner(frequency, time, true);
      }
    } else {
      matches = 0;
      previousNote = null;
      candidateSince = null;
    }

    if (time - lastDetected > 900) {
      clearDisplay();
      elements.status.textContent = "Listening · play one note";
    }
  }

  animation = requestAnimationFrame(analyse);
}

async function stopListening() {
  // Only modes that listen pause their clock when listening stops.
  if (!clickMode() && !(triadMode() && !triadSound())) pauseRunClock();
  if (recognitionMode()) updateRunTime();
  listening = false;
  cancelAnimationFrame(animation);
  microphone?.getTracks().forEach(track => track.stop());
  source?.disconnect();

  if (audioContext && audioContext.state !== "closed") {
    await audioContext.close();
  }

  microphone = source = analyser = audioContext = null;
  activeInputLabel = "";
  elements["audio-input"].disabled = false;
  showAudioInput();
  matches = 0;
  previousNote = null;
  candidateSince = null;
  lastDetected = lastAnalysis = lastTunerAnalysis = 0;
  quietSince = null;
  previousExerciseNote = null;
  exerciseMatches = 0;
  if (questionMode()) {
    if (triadSound() && runActive && runCount < runLength) setExerciseFeedback("neutral", null, "Run paused. Start listening to continue.");
  } else if (recognitionMode()) {
    if (runCount < runLength) setExerciseFeedback("neutral", null, "Run paused. Start listening to continue.");
  } else if (!exerciseComplete()) {
    setExerciseFeedback("neutral", null, "Exercise paused. Start listening to continue.");
  }

  clearDisplay();
  elements.start.textContent = "Start listening";
  elements.status.textContent = "Ready when you are";
}

async function startListening() {
  elements.start.disabled = true;
  elements["audio-input"].disabled = true;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Open this app through localhost to use the microphone.");
    }

    audioContext = new AudioContext();
    await audioContext.resume();

    microphone = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(elements["audio-input"].value ? { deviceId: { exact: elements["audio-input"].value } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    source = audioContext.createMediaStreamSource(microphone);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;

    // Analyse the microphone without playing it through the speakers.
    source.connect(analyser);
    buffer = new Float32Array(analyser.fftSize);

    listening = true;
    startRunClock();
    activeInputLabel = microphone.getAudioTracks()[0].label || "Browser default audio input";
    showAudioInput();
    void refreshAudioInputs();
    quietSince = null;
    if (questionMode()) {
      if (triadSound() && runActive && runCount < runLength) setExerciseFeedback("neutral", null, "Play the requested note.");
    } else if (recognitionMode()) {
      if (runCount < runLength) setExerciseFeedback("neutral", null, runActive ? "Find and play the requested note." : "Click New run when ready.");
    } else if (!exerciseComplete()) {
      setExerciseFeedback("neutral", null, rootStarted
        ? "Continue in any order. Mute the other strings."
        : `Start on ${pitchLabel(startingRoot.midi)}. Mute the other strings.`);
    }
    elements.start.textContent = "Stop listening";
    elements.status.textContent = "Listening · play one note";
    elements.message.textContent =
      "Mute the other strings. Play without bends or distortion.";

    microphone.getAudioTracks()[0].addEventListener("ended", () => {
      if (listening) void stopListening();
    });

    animation = requestAnimationFrame(analyse);
  } catch (error) {
    await stopListening();
    elements.status.textContent = "Microphone unavailable";
    elements.message.textContent =
      error.name === "NotAllowedError"
        ? "Allow microphone access in your browser, then try again."
        : error.name === "NotFoundError" || error.name === "OverconstrainedError"
          ? "The audio input is unavailable. Connect it or select another input, then try again."
          : error.message;
  } finally {
    elements.start.disabled = false;
  }
}

elements.start.addEventListener("click", async () => {
  elements.start.disabled = true;
  try {
    if (listening) await stopListening();
    else await startListening();
  } finally {
    elements.start.disabled = false;
  }
});

elements["audio-input"].addEventListener("change", showAudioInput);
navigator.mediaDevices?.addEventListener?.("devicechange", () => { void refreshAudioInputs(); });
void refreshAudioInputs();

window.addEventListener("pagehide", () => {
  microphone?.getTracks().forEach(track => track.stop());
});
