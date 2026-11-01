// Progress stats shared by every training mode: results per item (a note
// position, a chord, a scale pattern), run history, practice sets, the time
// limit and the stats panels. Loaded before app.js, like click-trainer.js; it
// uses that file's run state once the page has started.

const progressKey = "guitar-trainer-progress";
const progressRuns = 20;
const progressTimes = 5;
const practiceSize = 5;
let progress = {};
// Results of the current run, and the item being asked now.
let runItems = [];
let currentItem = null;
let itemStartElapsed = 0;
let lastResult = null;
let practiceSet = "all";
let timeLimit = 0;
let progressResetTimer = null;

function emptyProgress() {
  return { items: {}, runs: [], top10: [], missed: [], streak: 0, bestStreak: 0, last: null };
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(progressKey));
    if (saved && typeof saved === "object") {
      for (const [mode, stats] of Object.entries(saved)) {
        if (!stats || typeof stats !== "object") continue;
        progress[mode] = {
          ...emptyProgress(),
          items: stats.items && typeof stats.items === "object" ? stats.items : {},
          runs: Array.isArray(stats.runs) ? stats.runs.slice(-progressRuns) : [],
          top10: Array.isArray(stats.top10) ? stats.top10.slice(0, 10) : [],
          missed: Array.isArray(stats.missed) ? stats.missed : [],
          bestStreak: Number.isInteger(stats.bestStreak) ? stats.bestStreak : 0,
          last: stats.last || null
        };
      }
    }
  } catch {
    // Missing or broken stats start empty.
  }
}

function saveProgress() {
  try {
    localStorage.setItem(progressKey, JSON.stringify(progress));
  } catch {
    // The trainer keeps working without saved stats.
  }
}

function modeProgress() {
  return progress[trainingMode] ||= emptyProgress();
}

function scaleModes() {
  return !recognitionMode() && !questionMode();
}

// What one item is called in each mode.
function itemUnit() {
  return questionMode() ? "question" : recognitionMode() ? "note" : "exercise";
}

// Average-time limits (ms) for the heatmap colours: fast below, slow above.
function heatLimits() {
  if (questionMode()) return [heatFast, heatSlow];
  if (recognitionMode()) return [3000, 8000];
  if (chordMode()) return [10000, 25000];
  return [20000, 40000];
}

// Time on the run clock, so pauses do not count.
function runNow() {
  return runElapsed + (runStartedAt === null ? 0 : Date.now() - runStartedAt);
}

function itemElapsed() {
  return Math.max(0, runNow() - itemStartElapsed);
}

// Call when a new question, note or exercise is shown.
function startItem(item) {
  currentItem = item;
  itemMistake = false;
  itemStartElapsed = runNow();
}

function startRunItems() {
  runItems = [];
  lastResult = null;
}

function positionItem(position) {
  const name = recognitionNoteName(position.midi ?? midiAt(position.string, position.fret)).split(" / ")[0];
  const row = GuitarScales.strings.find(string => string.string === position.string);
  return { key: positionKey(position), label: `${name} · ${row.label}-string fret ${position.fret}`, group: name };
}

function triadItem(chord) {
  const name = triadChordName(chord);
  return { key: chordKey(chord), label: name, group: name };
}

function exerciseItem(choice) {
  const shape = GuitarScales.shapeByStringAndSide[choice.string][choice.side];
  if (chordMode()) {
    const name = choice.root + chordTypes[choice.type].symbol;
    return { key: `${choice.root}-${choice.type}-${shape}`, label: `${name} · ${shape} shape`, group: name };
  }
  const pattern = GuitarScales.patternNumbers[choice.type][shape];
  return { key: `${choice.root}-${choice.type}-${pattern}`, label: `${choice.root} ${choice.type} · pattern ${pattern}`, group: `${choice.root} ${choice.type}` };
}

// A result for the current item. The streak resets on a mistake or a timeout.
function recordItem(item, { ok, time, timeout = false }) {
  if (!item) return;
  const stats = modeProgress();
  const saved = stats.items[item.key] ||= { attempts: 0, correct: 0, timeouts: 0, times: [] };
  saved.label = item.label;
  saved.group = item.group;
  saved.attempts++;
  if (ok) saved.correct++;
  if (timeout) saved.timeouts++;
  // A wrong or late answer counts at least as slow.
  saved.times = [...(saved.times || []), Math.round(ok ? time : Math.max(time, heatLimits()[1]))].slice(-progressTimes);
  saved.last = ok ? "ok" : timeout ? "timeout" : "fail";
  stats.streak = ok ? stats.streak + 1 : 0;
  stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  runItems.push({ ...item, ok, time, timeout });
  lastResult = { ...item, ok, time, timeout };
  saveProgress();
}

// A finished run: history for the charts, the missed items, and the top 10
// for the modes without their own scoreboard.
function recordRun(types = "") {
  const stats = modeProgress();
  const questions = runItems.length || runLength;
  const entry = {
    at: new Date().toISOString(),
    types,
    questions,
    correct: runItems.filter(result => result.ok).length,
    mistakes: runMistakes,
    time: Math.round(runElapsed),
    average: Math.round(runElapsed / Math.max(1, questions))
  };
  stats.runs = [...stats.runs, entry].slice(-progressRuns);
  stats.missed = [...new Set(runItems.filter(result => !result.ok).map(result => result.key))];
  stats.last = entry;
  stats.top10 = [...stats.top10, entry].sort((a, b) => a.average - b.average || a.mistakes - b.mistakes).slice(0, 10);
  saveProgress();
  return entry;
}

function itemAverage(saved) {
  return saved.times?.length ? saved.times.reduce((sum, time) => sum + time, 0) / saved.times.length : null;
}

function itemAccuracy(saved) {
  return saved.attempts ? saved.correct / saved.attempts : 1;
}

// Worst first: lowest accuracy, then slowest.
function compareWorst(a, b) {
  return itemAccuracy(a) - itemAccuracy(b) || (itemAverage(b) ?? 0) - (itemAverage(a) ?? 0);
}

function practiceKeys() {
  if (practiceSet === "all") return null;
  const stats = modeProgress();
  if (practiceSet === "missed") return stats.missed.length ? new Set(stats.missed) : null;
  const tried = Object.entries(stats.items).filter(([, saved]) => saved.attempts);
  if (!tried.length) return null;
  return new Set(tried.sort((a, b) => compareWorst(a[1], b[1])).slice(0, practiceSize).map(([key]) => key));
}

// Keep the items of the practice set; when none fits the current settings,
// every item stays, so a run can always start.
function practiceFilter(list, itemOf) {
  const keys = practiceKeys();
  if (!keys) return list;
  const kept = list.filter(entry => keys.has(itemOf(entry).key));
  return kept.length ? kept : list;
}

// Time limit per question, note or exercise. 0 means off.
function timeLimitReached() {
  return timeLimit > 0 && runActive && runStartedAt !== null && itemElapsed() >= timeLimit * 1000;
}

function renderTimeBar() {
  const bar = exerciseUI["time-bar"];
  bar.hidden = timeLimit === 0;
  if (bar.hidden) return;
  const share = runActive ? Math.min(1, itemElapsed() / (timeLimit * 1000)) : 0;
  exerciseUI["time-bar-fill"].style.width = `${(share * 100).toFixed(1)}%`;
  bar.className = `time-bar${share > 0.75 ? " time-low" : ""}`;
}

function setTimeLimit(seconds) {
  timeLimit = seconds;
  exerciseUI["time-limit"].value = String(seconds);
  exerciseUI["time-limit-value"].textContent = seconds ? `${seconds} s` : "Off";
  renderTimeBar();
}

function setPracticeSet(value) {
  practiceSet = ["weakest", "missed"].includes(value) ? value : "all";
  exerciseUI["practice-set"].value = practiceSet;
}

function seconds(milliseconds, digits = 1) {
  return `${(milliseconds / 1000).toFixed(digits)} s`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

// Stats of the current run, plus the streak.
function renderStatTiles() {
  const stats = modeProgress();
  const done = runItems.length;
  const correct = runItems.filter(result => result.ok).length;
  const elapsed = runNow();
  const times = runItems.map(result => result.time);
  const tiles = [
    [itemUnit() === "exercise" ? "EXERCISES" : itemUnit() === "note" ? "NOTES" : "QUESTIONS", `${done} / ${runLength}`],
    ["ACCURACY", done ? `${Math.round(correct / done * 100)}%` : "—"],
    ["CORRECT", `<span class="good">✓ ${correct}</span>`],
    ["MISTAKES", `<span class="bad">✕ ${runMistakes}</span>`],
    ["STREAK", String(stats.streak)],
    ["BEST STREAK", String(stats.bestStreak)],
    [`AVG / ${itemUnit().toUpperCase()}`, done ? seconds(elapsed / done) : "—"],
    ["FASTEST", times.length ? seconds(Math.min(...times)) : "—"]
  ];
  exerciseUI["stat-tiles"].innerHTML = tiles.map(([label, value]) => `<div class="tile"><span>${label}</span><b>${value}</b></div>`).join("");
  exerciseUI["stat-last"].innerHTML = lastResult
    ? `<b>Last:</b> <span class="${lastResult.ok ? "good" : "bad"}">${lastResult.ok ? "✓" : "✕"}</span> ${escapeHtml(lastResult.label)} in ${seconds(lastResult.time)}${lastResult.timeout ? " (time's up)" : ""}`
    : "<b>Last:</b> —";
  exerciseUI["question-count"].textContent = `${Math.min(runLength, done + (runActive ? 1 : 0))} / ${runLength}`;
  renderTimeBar();
}

function renderRoundBox() {
  const stats = modeProgress();
  const last = stats.last;
  const missed = stats.missed.map(key => stats.items[key]?.label).filter(Boolean);
  exerciseUI["round-summary"].innerHTML = last
    ? `<b>Previous run</b> · ${last.correct ?? last.questions - last.mistakes}/${last.questions} correct · ${seconds(last.time)}<br>` +
      `<span class="muted">Missed:</span> ${missed.length ? escapeHtml(missed.slice(0, 6).join(", ")) + (missed.length > 6 ? ` +${missed.length - 6}` : "") : "none"}`
    : "No finished run yet.";
  exerciseUI["review-missed"].disabled = !missed.length;
}

function itemsHeading() {
  if (triadMode()) return "Per chord";
  if (questionMode() || recognitionMode()) return "Per note";
  return chordMode() ? "Per chord" : "Per scale";
}

// One row per group (note, chord or scale), worst first.
function renderItemTable() {
  const stats = modeProgress();
  const groups = new Map();
  for (const saved of Object.values(stats.items)) {
    if (!saved.attempts) continue;
    const group = groups.get(saved.group) || { name: saved.group, attempts: 0, correct: 0, times: [], last: null, lastAt: -1 };
    group.attempts += saved.attempts;
    group.correct += saved.correct;
    group.times.push(...(saved.times || []));
    groups.set(saved.group, group);
  }
  // The last result per group comes from this run when there is one.
  for (const result of runItems) {
    const group = groups.get(result.group);
    if (group) group.last = result.ok;
  }
  const rows = [...groups.values()].sort(compareWorst);
  exerciseUI["items-heading"].textContent = itemsHeading();
  exerciseUI["item-table"].innerHTML = rows.length
    ? `<table><tr><th>${itemsHeading().replace("Per ", "").replace(/^./, letter => letter.toUpperCase())}</th><th>Last</th><th>Acc</th><th>Avg</th><th>A</th><th>C</th></tr>` +
      rows.map(row => `<tr><td><b>${escapeHtml(row.name)}</b></td><td>${row.last === null ? "" : row.last ? '<span class="good">✓</span>' : '<span class="bad">✕</span>'}</td>` +
        `<td>${Math.round(itemAccuracy(row) * 100)}%</td><td>${row.times.length ? seconds(itemAverage(row)) : "—"}</td><td>${row.attempts}</td><td>${row.correct}</td></tr>`).join("") +
      "</table><p class=\"help\">A = attempts, C = correct</p>"
    : '<p class="help">No results yet. Finish a few questions or exercises.</p>';
}

function chartBars(values, max, format) {
  const width = 300, height = 130, left = 34, bottom = 112, step = (width - left - 6) / 10;
  const bars = values.map((value, index) => {
    const barHeight = Math.max(2, value / max * (bottom - 12));
    const level = format === "%" ? (value >= 85 ? "good" : value >= 60 ? "medium" : "bad") : "time";
    return `<rect class="bar-${level}" x="${left + index * step + 4}" y="${bottom - barHeight}" width="${step - 8}" height="${barHeight}" rx="3"><title>Run ${index + 1}: ${format === "%" ? `${value}%` : `${value.toFixed(1)} s`}</title></rect>` +
      `<text x="${left + index * step + step / 2}" y="${bottom + 14}" text-anchor="middle">${index + 1}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Chart"><line class="axis" x1="${left}" y1="${bottom}" x2="${width}" y2="${bottom}"/>` +
    `<text x="${left - 4}" y="16" text-anchor="end">${format === "%" ? "100%" : `${max.toFixed(0)} s`}</text><text x="${left - 4}" y="${bottom}" text-anchor="end">0</text>${bars}</svg>`;
}

function renderCharts() {
  const runs = modeProgress().runs.slice(-10);
  exerciseUI["time-chart-heading"].textContent = `Avg time per ${itemUnit()}`;
  if (!runs.length) {
    exerciseUI["chart-accuracy"].innerHTML = '<p class="help">No finished runs yet.</p>';
    exerciseUI["chart-time"].innerHTML = "";
    return;
  }
  const accuracy = runs.map(run => Math.round((run.correct ?? run.questions - Math.min(run.questions, run.mistakes)) / run.questions * 100));
  const averages = runs.map(run => run.average / 1000);
  exerciseUI["chart-accuracy"].innerHTML = chartBars(accuracy, 100, "%");
  exerciseUI["chart-time"].innerHTML = chartBars(averages, Math.max(1, ...averages) * 1.1, "s");
}

function heatOf(average) {
  const [fast, slow] = heatLimits();
  return average === null ? "none" : average < fast ? "fast" : average <= slow ? "medium" : "slow";
}

// A small grid: fretboard positions, chords or scale patterns.
function renderMiniHeatmap() {
  const stats = modeProgress();
  let html = "";
  if (clickMode() || recognitionMode()) {
    const names = { 1: "e", 2: "B", 3: "G", 4: "D", 5: "A", 6: "E" };
    const cells = [];
    for (let string = 1; string <= 6; string++) {
      cells.push(`<span class="mini-label">${names[string]}</span>`);
      for (let fret = 0; fret <= 15; fret++) {
        const position = { string, fret, midi: midiAt(string, fret) };
        const saved = stats.items[positionKey(position)];
        const average = clickMode() ? averageTime(position) : saved ? itemAverage(saved) : null;
        const level = clickMode() ? heatLevel(position) : heatOf(average);
        cells.push(`<span class="mini-cell heat-${level}" title="${positionItem(position).label}: ${average === null ? "not tried" : seconds(average)}"></span>`);
      }
    }
    cells.push('<span class="mini-label"></span>', ...Array.from({ length: 16 }, (_, fret) => `<span class="mini-label">${fret}</span>`));
    html = `<div class="mini-grid frets">${cells.join("")}</div>`;
  } else if (triadMode()) {
    const pcs = recognitionNotes === "all" ? [...Array(12).keys()] : naturalPcs;
    html = `<div class="mini-grid chords" style="grid-template-columns: repeat(${pcs.length}, 1fr)">` + ["major", "minor"].map(quality => pcs.map(pc => {
      const chord = { pc, quality };
      const average = triadAverage(chord);
      return `<span class="mini-cell named heat-${triadLevel(chord)}" title="${triadChordName(chord)}: ${average === null ? "not tried" : seconds(average)}">${triadChordName(chord)}</span>`;
    }).join("")).join("") + "</div>";
  } else {
    const columns = chordMode() ? ["E", "A", "C", "D", "G"] : ["1", "2", "3", "4", "5"];
    const rows = Object.keys(GuitarScales.naturals).flatMap(root => ["major", "minor"].map(type => ({ root, type })));
    const cells = [`<span class="mini-label"></span>`, ...columns.map(column => `<span class="mini-label">${chordMode() ? column : `P${column}`}</span>`)];
    for (const { root, type } of rows) {
      const name = chordMode() ? root + chordTypes[type].symbol : `${root} ${type === "major" ? "maj" : "min"}`;
      cells.push(`<span class="mini-label row-label">${name}</span>`);
      for (const column of columns) {
        const saved = stats.items[`${root}-${type}-${column}`];
        const average = saved ? itemAverage(saved) : null;
        cells.push(`<span class="mini-cell heat-${heatOf(average)}" title="${name} ${chordMode() ? `${column} shape` : `pattern ${column}`}: ${average === null ? "not tried" : seconds(average)}"></span>`);
      }
    }
    html = `<div class="mini-grid patterns">${cells.join("")}</div>`;
  }
  const [fast, slow] = heatLimits();
  exerciseUI["mini-heat-caption"].textContent = `average time · fast < ${fast / 1000} s · slow > ${slow / 1000} s`;
  exerciseUI["mini-heatmap"].innerHTML = html +
    '<p class="mini-legend"><span class="mini-cell heat-fast"></span>fast <span class="mini-cell heat-medium"></span>slow <span class="mini-cell heat-slow"></span>very slow / wrong <span class="mini-cell heat-none"></span>not tried</p>';
}

function renderTopFails() {
  const stats = modeProgress();
  const fails = Object.values(stats.items).map(saved => ({ ...saved, fails: saved.attempts - saved.correct }))
    .filter(saved => saved.fails > 0).sort((a, b) => b.fails - a.fails || compareWorst(a, b)).slice(0, 5);
  const most = Math.max(1, ...fails.map(saved => saved.fails));
  exerciseUI["top-fails"].innerHTML = fails.length
    ? fails.map((saved, index) => `<div class="fail"><span class="rank">#${index + 1}</span><span>${escapeHtml(saved.label)}</span>` +
      `<span class="fail-bar"><i style="width:${(saved.fails / most * 100).toFixed(0)}%"></i></span><b>${saved.fails}×</b></div>`).join("")
    : '<p class="help">No fails yet.</p>';
}

// Top 10 for the modes without their own scoreboard (click and triads keep theirs).
function renderProgressScoreboard() {
  const stats = modeProgress();
  const unit = itemUnit();
  exerciseUI["top10-unit"].textContent = `s / ${unit}`;
  if (questionMode()) return;
  const last = stats.last;
  exerciseUI["score-last"].textContent = last ? `Last run: ${seconds(last.time)} (${seconds(last.average, 2)}/${unit})` : "Last run: —";
  exerciseUI["score-streak"].textContent = `Streak: ${stats.streak} · Best: ${stats.bestStreak}`;
  exerciseUI["score-top10"].innerHTML = stats.top10.length
    ? stats.top10.map(entry => {
      const when = new Date(entry.at);
      const date = Number.isNaN(when.getTime()) ? "" : `${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      return `<li>${(entry.average / 1000).toFixed(2)} s/${unit === "exercise" ? "ex" : "note"} · ${entry.questions} · ${entry.mistakes} ${entry.mistakes === 1 ? "mistake" : "mistakes"} · ${date}</li>`;
    }).join("")
    : "<li class=\"score-empty\">No runs yet</li>";
}

function renderProgress() {
  renderStatTiles();
  renderRoundBox();
  renderItemTable();
  renderCharts();
  renderMiniHeatmap();
  renderTopFails();
  renderProgressScoreboard();
}

// Reset stats: click twice. Also clears the click and triad stats.
function resetProgress() {
  if (progressResetTimer === null) {
    exerciseUI["reset-stats"].textContent = "Click again to confirm";
    progressResetTimer = setTimeout(() => {
      progressResetTimer = null;
      exerciseUI["reset-stats"].textContent = "Reset stats";
    }, 4000);
    return;
  }
  clearTimeout(progressResetTimer);
  progressResetTimer = null;
  exerciseUI["reset-stats"].textContent = "Reset stats";
  progress[trainingMode] = emptyProgress();
  runItems = [];
  lastResult = null;
  saveProgress();
  if (clickMode()) {
    clickStats = { times: {}, top10: [], bestStreak: 0 };
    clickStreak = 0;
    saveClickStats();
  }
  if (triadMode()) {
    triadStats = { times: {}, top10: [], bestStreak: 0 };
    triadStreak = 0;
    saveTriadStats();
  }
  renderExercise();
}

// The click and triad modes kept their own best streak before; start from it.
function seedProgressStreaks() {
  for (const [mode, stats] of [["recognition-click", clickStats], ["triads", triadStats]]) {
    const saved = progress[mode] ||= emptyProgress();
    saved.bestStreak = Math.max(saved.bestStreak, stats.bestStreak || 0);
  }
}

function initProgress() {
  loadProgress();
  seedProgressStreaks();
  exerciseUI["practice-set"].addEventListener("change", () => {
    setPracticeSet(exerciseUI["practice-set"].value);
    saveSettings();
  });
  exerciseUI["time-limit"].addEventListener("input", () => {
    const value = Math.round(Number(exerciseUI["time-limit"].value) / 5) * 5;
    setTimeLimit(Number.isFinite(value) ? Math.max(0, Math.min(60, value)) : 0);
  });
  exerciseUI["time-limit"].addEventListener("change", saveSettings);
  exerciseUI["reset-stats"].addEventListener("click", resetProgress);
  // Review missed: a new run with the items missed in the last run.
  exerciseUI["review-missed"].addEventListener("click", () => {
    if (!modeProgress().missed.length) return;
    setPracticeSet("missed");
    saveSettings();
    newRun();
  });
  exerciseUI["show-answer"].addEventListener("click", () => giveUpItem(false));
}
