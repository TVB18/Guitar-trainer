// Fretboard recognition click: a recognition mode answered with the mouse or
// the keyboard instead of the microphone. Loaded before app.js; it uses that
// file's board, run clock and settings once the page has started.

const clickTypeNames = { name: "Name the note", find: "Find the note", nearest: "Nearest note" };
const clickTypeNumbers = { name: 1, find: 2, nearest: 3 };
const clickTypes = new Set(["name"]);
const clickStatsKey = "guitar-trainer-click-stats";
// Average response time thresholds for the heatmap, in milliseconds.
const heatFast = 2000;
const heatSlow = 5000;
// A position keeps its last few times, so the heatmap shows improvement.
const heatHistory = 5;
let clickStats = { times: {}, top10: [], bestStreak: 0 };
let clickQuestion = null;
let clickBlock = { type: null, left: 0 };
let clickStreak = 0;
let heatmapShown = false;
let heatmapSince = null;
let sharpPending = false;
let resetStatsTimer = null;

function clickMode() {
  return trainingMode === "recognition-click";
}

function positionKey(position) {
  return `${position.string}-${position.fret}`;
}

function loadClickStats() {
  try {
    const saved = JSON.parse(localStorage.getItem(clickStatsKey));
    if (saved && typeof saved === "object") {
      clickStats = {
        times: saved.times && typeof saved.times === "object" ? saved.times : {},
        top10: Array.isArray(saved.top10) ? saved.top10.slice(0, 10) : [],
        bestStreak: Number.isInteger(saved.bestStreak) ? saved.bestStreak : 0
      };
    }
  } catch {
    // Missing or broken stats start empty.
  }
}

function saveClickStats() {
  try {
    localStorage.setItem(clickStatsKey, JSON.stringify(clickStats));
  } catch {
    // The trainer keeps working without saved stats.
  }
}

function averageTime(position) {
  const times = clickStats.times[positionKey(position)];
  return times?.length ? times.reduce((sum, time) => sum + time, 0) / times.length : null;
}

function recordTime(position, milliseconds) {
  const key = positionKey(position);
  clickStats.times[key] = [...(clickStats.times[key] || []), Math.round(milliseconds)].slice(-heatHistory);
}

function heatLevel(position) {
  const average = averageTime(position);
  return average === null ? "none" : average < heatFast ? "fast" : average <= heatSlow ? "medium" : "slow";
}

// Weak and untried positions come up more often; known ones still appear.
function positionWeight(position) {
  return { none: 4, slow: 4, medium: 2, fast: 1 }[heatLevel(position)];
}

function weightedChoice(positions) {
  const total = positions.reduce((sum, position) => sum + positionWeight(position), 0);
  let pick = Math.random() * total;
  for (const position of positions) {
    pick -= positionWeight(position);
    if (pick < 0) return position;
  }
  return positions.at(-1);
}

function clickPositions() {
  const targets = recognitionNotes === "all" ? allRecognitionTargets : recognitionTargets;
  return targets.filter(target => recognitionStrings.has(target.string));
}

function midiAt(string, fret) {
  return GuitarScales.strings.find(row => row.string === string).open + fret;
}

// Types come in blocks of 3–5 questions, so the type does not change constantly.
function nextClickType() {
  if (clickBlock.left > 0 && clickTypes.has(clickBlock.type)) {
    clickBlock.left--;
    return clickBlock.type;
  }
  const types = [...clickTypes];
  const others = types.length > 1 ? types.filter(type => type !== clickBlock.type) : types;
  clickBlock = { type: others[Math.floor(Math.random() * others.length)], left: randomBetween(3, 5) - 1 };
  return clickBlock.type;
}

// The odd fret range around a highlighted fret, shifted to stay on the board.
function nearestRange(fret) {
  const width = Math.min(16, frameFrets % 2 ? frameFrets : frameFrets + 1);
  const half = Math.floor(width / 2);
  const fromFret = Math.max(0, Math.min(16 - width, fret - half));
  return { fromFret, toFret: fromFret + width - 1 };
}

function chooseClickQuestion() {
  const type = nextClickType();
  const previous = clickQuestion?.seed;
  const positions = clickPositions().filter(position => !previous || positionKey(position) !== positionKey(previous));
  const seed = weightedChoice(positions.length ? positions : clickPositions());
  const pc = seed.midi % 12;
  const question = { type, seed, pc, targets: [], found: new Set(), wrong: [], mistake: false, frame: null, highlightFret: null, startedAt: Date.now() };
  if (type === "name") {
    question.targets = [seed];
  } else if (type === "find") {
    question.frame = frameAround(seed);
    const { fromFret, toFret, fromString, toString } = question.frame;
    for (let string = fromString; string <= toString; string++) {
      for (let fret = fromFret; fret <= toFret; fret++) {
        if (midiAt(string, fret) % 12 === pc) question.targets.push({ string, fret, midi: midiAt(string, fret) });
      }
    }
  } else {
    // Highlight a fret near the seed, then find the nearest occurrence on every selected string.
    const width = Math.min(16, frameFrets % 2 ? frameFrets : frameFrets + 1);
    const half = Math.floor(width / 2);
    question.highlightFret = randomBetween(Math.max(0, seed.fret - half), Math.min(15, seed.fret + half));
    const range = nearestRange(question.highlightFret);
    const strings = [...recognitionStrings].sort((a, b) => a - b);
    question.frame = { ...range, fromString: strings[0], toString: strings.at(-1) };
    for (const string of strings) {
      const frets = [];
      for (let fret = range.fromFret; fret <= range.toFret; fret++) {
        if (midiAt(string, fret) % 12 === pc) frets.push(fret);
      }
      if (!frets.length) continue;
      const distance = Math.min(...frets.map(fret => Math.abs(fret - question.highlightFret)));
      // On a tie both occurrences are equally near, so both count.
      for (const fret of frets.filter(fret => Math.abs(fret - question.highlightFret) === distance)) {
        question.targets.push({ string, fret, midi: midiAt(string, fret) });
      }
    }
  }
  clickQuestion = question;
  sharpPending = false;
}

function restartClickRun(start = false) {
  cancelNextExercise();
  pauseRunClock();
  hideHeatmap(false);
  runActive = start;
  runElapsed = 0;
  runCount = 0;
  runMistakes = 0;
  // The streak carries over between runs; only a wrong answer resets it.
  clickBlock = { type: null, left: 0 };
  runLength = readRunLength("run-length");
  chooseClickQuestion();
  renderExercise();
  updateRunTime();
  if (start) startRunClock();
  setExerciseFeedback("neutral", null, start ? "Answer as fast as you can." : "Click New run when ready.");
}

function questionDone() {
  return clickQuestion.found.size === clickQuestion.targets.length;
}

function clickAnswerAllowed() {
  return clickMode() && runActive && runCount < runLength && !heatmapShown && nextExerciseTimer === null;
}

function clickMistake(message) {
  clickQuestion.mistake = true;
  runMistakes++;
  clickStreak = 0;
  updateRunTime();
  renderClick();
  setExerciseFeedback("error", null, message);
}

function clickCorrect(position) {
  const elapsed = Date.now() - clickQuestion.startedAt;
  // A question with a wrong answer counts at least as slow for these positions.
  recordTime(position, clickQuestion.mistake ? Math.max(elapsed, heatSlow) : elapsed);
  clickQuestion.found.add(positionKey(position));
  if (!questionDone()) {
    renderClick();
    setExerciseFeedback("correct", null, `Correct. ${clickQuestion.found.size} of ${clickQuestion.targets.length} found.`);
    return;
  }
  if (!clickQuestion.mistake) {
    clickStreak++;
    clickStats.bestStreak = Math.max(clickStats.bestStreak, clickStreak);
  }
  runCount++;
  saveClickStats();
  if (runCount >= runLength) {
    finishClickRun();
    return;
  }
  chooseClickQuestion();
  renderExercise();
  updateRunTime();
  setExerciseFeedback("correct", null, `Correct! ${(elapsed / 1000).toFixed(1)} s`);
}

function finishClickRun() {
  pauseRunClock();
  runActive = false;
  const entry = {
    at: new Date().toISOString(),
    types: [...clickTypes].map(type => clickTypeNumbers[type]).sort().join("+"),
    questions: runLength,
    mistakes: runMistakes,
    time: Math.round(runElapsed),
    average: Math.round(runElapsed / runLength)
  };
  clickStats.last = entry;
  clickStats.top10 = [...clickStats.top10, entry].sort((a, b) => a.average - b.average || a.mistakes - b.mistakes).slice(0, 10);
  saveClickStats();
  updateRunTime();
  renderExercise();
  const summary = `Run complete in ${(entry.time / 1000).toFixed(1)} s (${(entry.average / 1000).toFixed(2)} s/question) with ${entry.mistakes} ${entry.mistakes === 1 ? "mistake" : "mistakes"}!`;
  if (autoContinue) scheduleNext("run-complete", null, summary, "Next run");
  else setExerciseFeedback("run-complete", null, `${summary} Choose New run to try again.`);
}

// Type 1: a note name from a button or a key.
function answerName(pc) {
  if (!clickAnswerAllowed() || clickQuestion.type !== "name") return;
  sharpPending = false;
  if (pc === clickQuestion.pc) clickCorrect(clickQuestion.seed);
  else clickMistake(`Not ${recognitionNoteName(pc)}. Try again.`);
}

// Types 2 and 3: a click on a position of the board.
function clickCell(string, fret) {
  if (!clickAnswerAllowed() || clickQuestion.type === "name") return;
  const key = positionKey({ string, fret });
  if (clickQuestion.found.has(key)) return;
  const target = clickQuestion.targets.find(position => positionKey(position) === key);
  if (target) {
    clickCorrect(target);
    return;
  }
  if (!clickQuestion.wrong.some(position => positionKey(position) === key)) clickQuestion.wrong.push({ string, fret });
  const name = recognitionNoteName(midiAt(string, fret));
  clickMistake(clickQuestion.type === "find"
    ? `That is ${name}. Find every ${recognitionNoteName(clickQuestion.pc)} inside the frame.`
    : `That is ${name}, or not the nearest one. Look near fret ${clickQuestion.highlightFret}.`);
}

const keyPitchClasses = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// Keys ignore case; H before a letter makes it sharp (H then C = C♯).
function handleClickKey(event) {
  if (!clickMode() || event.ctrlKey || event.metaKey || event.altKey) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName || "")) return;
  const key = String(event.key).toLowerCase();
  if (key === "h") {
    sharpPending = !sharpPending;
    renderAnswerButtons();
    event.preventDefault?.();
    return;
  }
  if (!(key in keyPitchClasses)) return;
  event.preventDefault?.();
  answerName((keyPitchClasses[key] + (sharpPending ? 1 : 0)) % 12);
}

function renderAnswerButtons() {
  const container = exerciseUI["answer-buttons"];
  const show = clickMode() && clickQuestion?.type === "name" && !heatmapShown;
  container.hidden = !show;
  if (!show) return;
  const classes = recognitionNotes === "all" ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [0, 2, 4, 5, 7, 9, 11];
  container.className = `answer-buttons${recognitionNotes === "all" ? " all-notes" : ""}${sharpPending ? " sharp-pending" : ""}`;
  container.innerHTML = classes.map(pc => {
    const [name, flat] = recognitionNoteName(pc).split(" / ");
    return `<button type="button" data-pc="${pc}">${name}${flat ? `<small>${flat}</small>` : ""}</button>`;
  }).join("");
}

function hideHeatmap(resume = true) {
  if (!heatmapShown) return;
  heatmapShown = false;
  // The paused time does not count for the question.
  if (clickQuestion && heatmapSince !== null) clickQuestion.startedAt += Date.now() - heatmapSince;
  heatmapSince = null;
  if (resume && runActive) startRunClock();
}

function toggleHeatmap() {
  if (!clickMode()) return;
  if (heatmapShown) {
    hideHeatmap();
    setExerciseFeedback("neutral", null, runActive ? "Continue." : "Click New run when ready.");
  } else {
    heatmapShown = true;
    heatmapSince = Date.now();
    pauseRunClock();
    updateRunTime();
    setExerciseFeedback("neutral", null, "Heatmap shown, the run is paused. Click Heatmap again to continue.");
  }
  renderExercise();
}

function drawHeatmap() {
  const notes = clickPositions().map(position => {
    const average = averageTime(position);
    return {
      string: position.string,
      fret: position.fret,
      name: recognitionNoteName(position.midi).split(" / ")[0],
      degree: average === null ? "" : (average / 1000).toFixed(1),
      kind: `heat-${heatLevel(position)}`
    };
  });
  drawBoard({ string: null, label: "", notes, description: "Heatmap of average response times per position." });
}

function renderClick() {
  const question = clickQuestion;
  const complete = runCount >= runLength;
  const name = recognitionNoteName(question.pc);
  exerciseUI["exercise-title"].textContent = complete ? "Run complete" : heatmapShown ? "Heatmap" : "Fretboard recognition click";
  exerciseUI["training-mode-help"].textContent = "Answer with the mouse or the keyboard: C–B keys, H before a letter for a sharp. Click New run to start. Heatmap pauses the run.";
  exerciseUI["exercise-direction"].hidden = false;
  exerciseUI["exercise-direction"].textContent = clickTypeNames[question.type];
  exerciseUI["requested-string"].hidden = false;
  exerciseUI["note-region"].hidden = true;
  exerciseUI["exercise-progress"].max = runLength;
  exerciseUI["exercise-progress"].value = runCount;
  exerciseUI["progress-text"].textContent = `${runCount} / ${runLength} questions`;
  exerciseUI["heatmap-legend"].hidden = !heatmapShown;
  exerciseUI["toggle-heatmap"].textContent = heatmapShown ? "Hide heatmap" : "Heatmap";
  renderScoreboard();
  renderAnswerButtons();
  if (heatmapShown) {
    drawHeatmap();
    return;
  }
  const found = question.targets.filter(position => question.found.has(positionKey(position)));
  const marks = [
    ...question.wrong.map(position => ({ ...position, name: recognitionNoteName(midiAt(position.string, position.fret)).split(" / ")[0], degree: "", kind: "wrong" })),
    ...found.map(position => ({ ...position, name: name.split(" / ")[0], degree: "", kind: "found", played: true }))
  ];
  if (question.type === "name") {
    exerciseUI["expected-label"].textContent = "NAME THIS NOTE";
    exerciseUI["expected-note"].textContent = "?";
    exerciseUI["requested-string"].textContent = stringLabel(GuitarScales.strings.find(row => row.string === question.seed.string));
    exerciseUI["expected-position"].textContent = "Click its name or press its key";
    drawBoard({ string: null, label: "", focusFret: question.seed.fret, notes: [{ ...question.seed, name: "?", degree: "", kind: "question" }],
      description: `Fretboard. Name the note on string ${question.seed.string}, fret ${question.seed.fret}.` });
    return;
  }
  exerciseUI["expected-label"].textContent = question.type === "find" ? "FIND EVERY" : "NEAREST";
  exerciseUI["expected-note"].textContent = name;
  exerciseUI["requested-string"].textContent = question.type === "find" ? "inside the frame" : `to fret ${question.highlightFret}`;
  exerciseUI["expected-position"].textContent = `Found ${found.length} / ${question.targets.length}`;
  drawBoard({ string: null, label: "", frame: question.frame, highlightFret: question.highlightFret, notes: marks, clickable: true,
    description: question.type === "find"
      ? `Fretboard. Click every ${name} inside the frame: frets ${question.frame.fromFret} to ${question.frame.toFret}, strings ${question.frame.fromString} to ${question.frame.toString}.`
      : `Fretboard. Click the ${name} nearest to fret ${question.highlightFret} on every selected string, within frets ${question.frame.fromFret} to ${question.frame.toFret}.` });
}

function formatRunEntry(entry) {
  const when = new Date(entry.at);
  const date = Number.isNaN(when.getTime()) ? "" : `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return `${(entry.average / 1000).toFixed(2)} s/q · ${entry.questions} q · ${entry.mistakes} ${entry.mistakes === 1 ? "mistake" : "mistakes"} · type ${entry.types} · ${date}`;
}

function renderScoreboard() {
  const last = clickStats.last;
  exerciseUI["score-last"].textContent = last
    ? `Last run: ${(last.time / 1000).toFixed(1)} s (${(last.average / 1000).toFixed(2)} s/question)`
    : "Last run: —";
  exerciseUI["score-streak"].textContent = `Streak: ${clickStreak} · Best: ${clickStats.bestStreak}`;
  exerciseUI["score-top10"].innerHTML = clickStats.top10.length
    ? clickStats.top10.map(entry => `<li>${formatRunEntry(entry)}</li>`).join("")
    : "<li class=\"score-empty\">No runs yet</li>";
}

function resetClickStats() {
  if (!clickMode()) return;
  if (resetStatsTimer === null) {
    exerciseUI["reset-stats"].textContent = "Click again to confirm";
    resetStatsTimer = setTimeout(() => {
      resetStatsTimer = null;
      exerciseUI["reset-stats"].textContent = "Reset stats";
    }, 4000);
    return;
  }
  clearTimeout(resetStatsTimer);
  resetStatsTimer = null;
  exerciseUI["reset-stats"].textContent = "Reset stats";
  clickStats = { times: {}, top10: [], bestStreak: 0 };
  clickStreak = 0;
  saveClickStats();
  renderExercise();
}

function setClickTypes(types) {
  clickTypes.clear();
  for (const type of types) if (type in clickTypeNames) clickTypes.add(type);
  if (!clickTypes.size) clickTypes.add("name");
  for (const type of Object.keys(clickTypeNames)) exerciseUI[`click-type-${type}`].checked = clickTypes.has(type);
}

function initClickTrainer() {
  loadClickStats();
  exerciseUI["board-scroll"].addEventListener("click", event => {
    const cell = event.target?.closest?.("[data-fret]");
    if (cell) clickCell(Number(cell.getAttribute("data-string")), Number(cell.getAttribute("data-fret")));
  });
  // The answer buttons, Heatmap and Reset stats are shared with the triad mode.
  exerciseUI["answer-buttons"].addEventListener("click", event => {
    const button = event.target?.closest?.("button");
    if (!button) return;
    if (triadMode()) {
      if (button.hasAttribute("data-pc")) answerTriadNote(Number(button.getAttribute("data-pc")));
      if (button.hasAttribute("data-chord-pc")) answerTriadChord(Number(button.getAttribute("data-chord-pc")), button.getAttribute("data-quality"));
    } else if (button.hasAttribute("data-pc")) {
      answerName(Number(button.getAttribute("data-pc")));
    }
  });
  window.addEventListener("keydown", event => (triadMode() ? handleTriadKey : handleClickKey)(event));
  exerciseUI["toggle-heatmap"].addEventListener("click", () => (triadMode() ? toggleTriadHeatmap : toggleHeatmap)());
  exerciseUI["reset-stats"].addEventListener("click", () => (triadMode() ? resetTriadStats : resetClickStats)());
  for (const type of Object.keys(clickTypeNames)) {
    exerciseUI[`click-type-${type}`].addEventListener("change", () => {
      const checkbox = exerciseUI[`click-type-${type}`];
      if (!checkbox.checked && clickTypes.size === 1) {
        checkbox.checked = true;
        return;
      }
      if (checkbox.checked) clickTypes.add(type);
      else clickTypes.delete(type);
      if (clickMode()) restartClickRun(false);
      saveSettings();
    });
  }
}
