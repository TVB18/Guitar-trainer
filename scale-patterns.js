"use strict";

// Movable CAGED templates, strings 6 -> 1. Offsets are relative to the
// indicated anchor root, not a shared box number (major/minor differ).
// See JustinGuitar's five-pattern lessons for the CAGED/scale relationship:
// https://www.justinguitar.com/guitar-lessons/major-pentatonic-the-five-patterns-sc-404
// https://www.justinguitar.com/guitar-lessons/minor-pentatonic-the-5-patterns-sc-304
const GuitarScales = (() => {
  const strings = [
    { string: 6, label: "low E", open: 40 },
    { string: 5, label: "A", open: 45 },
    { string: 4, label: "D", open: 50 },
    { string: 3, label: "G", open: 55 },
    { string: 2, label: "B", open: 59 },
    { string: 1, label: "high E", open: 64 }
  ];
  const naturals = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const definitions = {
    major: { intervals: [0, 2, 4, 7, 9], degrees: [0, 1, 2, 4, 5], chord: [0, 4, 7] },
    minor: { intervals: [0, 3, 5, 7, 10], degrees: [0, 2, 3, 4, 6], chord: [0, 3, 7] }
  };
  const templates = {
    C: {
      anchorString: 5,
      major: { frets: [[-3,0],[-3,0],[-3,-1],[-3,-1],[-2,0],[-3,0]], chord: [null,0,-1,-3,-2,-3] },
      minor: { frets: [[-2,0],[-2,0],[-2,0],[-3,0],[-2,1],[-2,0]], chord: [null,0,-2,-3,-2,null] }
    },
    A: {
      anchorString: 5,
      major: { frets: [[0,2],[0,2],[-1,2],[-1,2],[0,2],[0,2]], chord: [null,0,2,2,2,0] },
      minor: { frets: [[0,3],[0,3],[0,2],[0,2],[1,3],[0,3]], chord: [null,0,2,2,1,0] }
    },
    G: {
      anchorString: 6,
      major: { frets: [[-3,0],[-3,-1],[-3,-1],[-3,-1],[-3,0],[-3,0]], chord: [0,-1,-3,-3,-3,0] },
      minor: { frets: [[-2,0],[-2,0],[-3,0],[-3,0],[-2,0],[-2,0]], chord: [0,-2,-3,-3,0,0] }
    },
    E: {
      anchorString: 6,
      major: { frets: [[0,2],[-1,2],[-1,2],[-1,1],[0,2],[0,2]], chord: [0,2,2,1,0,0] },
      minor: { frets: [[0,3],[0,2],[0,2],[0,2],[0,3],[0,3]], chord: [0,2,2,0,0,0] }
    },
    D: {
      anchorString: 4,
      major: { frets: [[0,2],[0,2],[0,2],[-1,2],[0,3],[0,2]], chord: [null,null,0,2,3,2] },
      minor: { frets: [[1,3],[0,3],[0,3],[0,2],[1,3],[1,3]], chord: [null,null,0,2,3,1] }
    }
  };

  // Player-view convention agreed for this trainer: lower frets to the left,
  // higher frets to the right. A on string 2, fret 10: left D, right C.
  // Select the form from a root's STRING and SIDE, never at random by shape.
  const shapeByStringAndSide = {
    6: { left: "G", right: "E" },
    5: { left: "C", right: "A" },
    4: { left: "E", right: "D" },
    3: { left: "A", right: "G" },
    2: { left: "D", right: "C" },
    1: { left: "G", right: "E" }
  };

  // Fixed box geometry numbering, referenced to A minor at fret 5.
  // Major scales use the same five boxes, with different roots/chord forms.
  const patternNumbers = {
    minor: { E: 1, D: 2, C: 3, A: 4, G: 5 },
    major: { G: 1, E: 2, D: 3, C: 4, A: 5 }
  };

  function build(root, type, shapeName, requestedAnchorFret = null) {
    if (!(root in naturals) || !(type in definitions) || !(shapeName in templates)) {
      throw new Error("Choose a natural root, pentatonic scale and CAGED shape.");
    }
    const rootPC = naturals[root];
    const definition = definitions[type];
    const template = templates[shapeName][type];
    const anchor = strings.find(row => row.string === templates[shapeName].anchorString);
    let anchorFret = (rootPC - anchor.open % 12 + 12) % 12;
    const lowestOffset = Math.min(...template.frets.flat(), ...template.chord.filter(offset => offset !== null));
    while (anchorFret + lowestOffset < 0) anchorFret += 12;
    if (requestedAnchorFret !== null) {
      if (!Number.isInteger(requestedAnchorFret) || requestedAnchorFret < 0 ||
          (anchor.open + requestedAnchorFret) % 12 !== rootPC || requestedAnchorFret + lowestOffset < 0) {
        throw new Error("The anchor must place the requested root in a playable position.");
      }
      anchorFret = requestedAnchorFret;
    }
    const notes = strings.flatMap((row, index) => template.frets[index].map(offset => ({
      ...row, fret: anchorFret + offset, midi: row.open + anchorFret + offset
    })));
    const chordNotes = strings.flatMap((row, index) => template.chord[index] === null ? [] : [{
      ...row, fret: anchorFret + template.chord[index], midi: row.open + anchorFret + template.chord[index]
    }]);
    const letters = Object.keys(naturals);
    const spellings = {};
    definition.intervals.forEach((interval, index) => {
      const letter = letters[(letters.indexOf(root) + definition.degrees[index]) % 7];
      const pc = (rootPC + interval) % 12;
      let accidental = (pc - naturals[letter] + 12) % 12;
      if (accidental > 6) accidental -= 12;
      spellings[pc] = letter + (accidental > 0 ? "♯".repeat(accidental) : "♭".repeat(-accidental));
    });
    return {
      root, rootPC, type, shapeName, notes, chordNotes, spellings,
      patternNumber: patternNumbers[type][shapeName],
      scaleNames: definition.intervals.map(interval => spellings[(rootPC + interval) % 12]),
      roots: chordNotes.filter(note => note.midi % 12 === rootPC),
      pitchClasses: new Set(definition.intervals.map(interval => (rootPC + interval) % 12)),
      chordClasses: new Set(definition.chord.map(interval => (rootPC + interval) % 12)),
      pitches: new Set(notes.map(note => note.midi)),
      chordPitches: definition.chord.map(interval => (rootPC + interval) % 12),
      minFret: Math.min(...notes.map(note => note.fret)),
      maxFret: Math.max(...notes.map(note => note.fret)),
      anchorFret
    };
  }
  function buildAssignment(root, string, side, type) {
    const row = strings.find(candidate => candidate.string === string);
    const shapeName = shapeByStringAndSide[string]?.[side];
    if (!row || !shapeName || !(root in naturals) || !(type in definitions)) {
      throw new Error("An assignment needs root A–G, string 1–6, left/right and major/minor.");
    }
    const template = templates[shapeName][type];
    const rootOffset = template.chord[strings.indexOf(row)];
    let fret = (naturals[root] - row.open % 12 + 12) % 12;
    // Use a fretted root. If a headstock-side form falls below fret 0,
    // move the entire assignment up one octave, including its starting root.
    if (fret === 0) fret = 12;
    const lowestOffset = Math.min(...template.frets.flat(), ...template.chord.filter(offset => offset !== null));
    while (fret - rootOffset + lowestOffset < 0) fret += 12;
    const model = build(root, type, shapeName, fret - rootOffset);
    const startingRoot = model.chordNotes.find(note => note.string === string && note.fret === fret);
    if (!startingRoot || startingRoot.midi % 12 !== model.rootPC) {
      throw new Error("The derived chord shape must contain the assigned root.");
    }
    return { ...model, startingRoot, startingString: string, side };
  }

  function listNotes(model) {
    return model.notes.map(note => ({
      string: note.string, stringName: note.label, fret: note.fret,
      note: model.spellings[note.midi % 12] + (Math.floor(note.midi / 12) - 1),
      midi: note.midi
    }));
  }
  return { build, buildAssignment, listNotes, strings, naturals, definitions, templates, shapeByStringAndSide, patternNumbers };
})();

if (typeof module !== "undefined" && module.exports) module.exports = GuitarScales;
