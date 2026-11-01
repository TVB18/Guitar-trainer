const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');

function trainer(sampleRate = 48000, sourceCode = code, attackNoise = 0) {
  const nodes = {};
  const timers = new Map();
  let timerClock = 0;
  let nextTimer = 0;
  let stream = [];
  let frameTime = 0;
  const advances = [];
  const analyser = {
    getFloatTimeDomainData(buffer) {
      // A rolling 2048-sample audio window, including note transitions.
      for (let i = 0; i < buffer.length; i++) {
        const time = frameTime - (buffer.length - 1 - i) * 1000 / sampleRate;
        const segment = stream.find(s => time >= s.start && time < s.end);
        if (!segment || segment.midi === null) { buffer[i] = 0; continue; }
        const hz = 440 * 2 ** ((segment.midi - 69) / 12);
        const phase = 2 * Math.PI * hz * (time - segment.start) / 1000;
        // Fundamental plus harmonics, with a decaying plucked envelope.
        const envelope = 0.2 * Math.exp(-(time - segment.start) / 500);
        buffer[i] = envelope * (Math.sin(phase) + 0.3 * Math.sin(2 * phase) + 0.15 * Math.sin(3 * phase));
        // A short nonperiodic attack, approximating pick/string noise.
        const age = time - segment.start;
        if (attackNoise && age < 10) {
          buffer[i] *= Math.min(1, age / 5);
          buffer[i] += attackNoise * Math.exp(-age / 3) *
            (Math.sin(age * 17.13) + Math.sin(age * 29.71));
        }
      }
    }
  };
  const context = vm.createContext({
    document: { getElementById(id) {
      return nodes[id] ||= { textContent: '', value: '', hidden: true, style: {}, handlers: {},
        addEventListener(event, callback) { this.handlers[event] = callback; },
        querySelectorAll() { return []; }, setAttribute(name, value) { this[name] = value; } };
    } },
    window: { addEventListener() {} }, navigator: {},
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, at: timerClock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Float32Array, Math, testAnalyser: analyser, testSampleRate: sampleRate
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'scale-patterns.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'click-trainer.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'triad-trainer.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'progress-stats.js'), 'utf8'), context);
  vm.runInContext(sourceCode, context);
  vm.runInContext('listening = true; analyser = testAnalyser; audioContext = { sampleRate: testSampleRate, state: "running", async close() { this.state = "closed"; } }; buffer = new Float32Array(2048);', context);
  const read = expression => vm.runInContext(expression, context);
  return {
    nodes, read, advances,
    advanceTimers(milliseconds) {
      const target = timerClock + milliseconds;
      while (true) {
        const next = [...timers.entries()].filter(([,timer]) => timer.at <= target).sort((a,b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timerClock = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      timerClock = target;
    },
    play(midi, duration) {
      const end = frameTime + duration;
      const previous = stream.at(-1);
      if (previous && previous.midi === midi && Math.abs(previous.end - frameTime) < 0.001) {
        previous.end = end;
      } else {
        stream.push({ midi, start: frameTime, end });
      }
      // Simulate a 60 Hz browser animation loop, not direct exercise calls.
      while (frameTime + 1000 / 60 <= end + 0.001) {
        frameTime += 1000 / 60;
        context.testTime = frameTime;
        const previousIndex = read('playedPitches.size');
        read('analyse(testTime)');
        if (read('playedPitches.size') > previousIndex) advances.push({ index: read('playedPitches.size'), time: frameTime });
      }
    }
  };
}


module.exports = { trainer, code };
