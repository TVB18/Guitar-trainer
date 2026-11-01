# Guitar Trainer

Serve this folder locally, then open it in a browser:

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000` and allow microphone access.

Training modes: Train scales, Train scales with first note, Train chord with
first note, Fretboard recognition visual, Fretboard recognition click and
Spell the triad. All modes share one fretboard view (open string through fret
15), with the requested string coloured and its note in a label beside the
board.

In the two scale modes the trainer assigns a natural root (A–G), string, side
and major/minor pentatonic scale. The chord shape is derived from the root, string and side;
it is not selectable. The scale may contain sharps or flats. New exercise
generates a different assignment. Restart keeps the same assignment.

Five seconds after New exercise, a red Pattern 1–5 hint appears beneath Scale
notes. Pattern 1 is the familiar A-minor box at fret 5; patterns 2–5 follow
towards higher frets. Major scales use the same box geometry numbering.
This hint is independent of Show/Hide hint.

| Pattern | Minor CAGED form | Major CAGED form |
| --- | --- | --- |
| 1 | E | G |
| 2 | D | E |
| 3 | C | D |
| 4 | A | C |
| 5 | G | A |

Left/right use the agreed player-view convention: left is the lower-fret
side, right is the higher-fret side. For A on the B string at fret 10,
left derives the D shape and right derives the C shape. The side is shown as a
frame around the pattern's frets on the fretboard, which numbers frets from
left to right. Train scales shows the frame from the start. Train scales with
first note first shows the coloured string and a frame around the root (the
Frame frets/strings sizes from Fretboard recognition visual, with the root at
a random spot inside it). Once the root is played in the right octave, the
scale and the pattern frame appear. Near the nut, an assignment
may move up an octave to keep the whole pattern playable.

Start on the assigned root and octave. Then play the pattern in any order.
Progress counts distinct pitches including octave; repetitions are allowed.
Play every pitch in the pattern to complete the assignment. You can continue
playing afterwards: wrong pitches still receive red feedback.

Train chord with first note works like Train scales with first note, but for
the chord instead of the scale. After the root is found, the title shows the
chord (for example "Am") and a chord label appears beside the fretboard: the
symbol in large letters with its type underneath, coloured per chord type
(major blue, minor orange; a new type needs a row in `chordTypes` and a colour
in styles.css). The
CAGED shape is not named, because finding it is the exercise. A frame
surrounds the grip and ✕ marks the strings that are not played. Play every
note of the grip one at a time, in any order, and mute each note before the
next one: notes that ring together can't be recognised. Each correct note
appears with its degree. There is no Pattern hint, and scale notes outside the
chord count as mistakes.

The grips follow this list (frets per string 6→1, x = not played; moved up
the neck with the root):

| Shape | Major | Minor |
| --- | --- | --- |
| C | x3201x | root on 5: x310xx, root on 2: xx101x |
| A | x1333x | x13321 |
| G | root on 6: 320xxx, root on 3 or 1: xx0003 | root on 6: 310xxx, root on 3 or 1: not trained |
| E | 022100 | 022000 |
| D | xxx232 | xxx231 |

Assignments without a grip, or whose root string is not part of the grip (the
D shape from string 4), are skipped by New exercise. Chord types are listed in
`chordTypes` in app.js so that 7th chords can be added later.

In the first three modes, exercises come in runs. Set "Exercises per run"
(1–100, default 10). The line under it shows the current exercise, the time and
the number of mistakes. The clock only runs during an exercise, not while a
finished exercise is shown. Wrong notes count as mistakes until the exercise is
finished, with the same mute filters as Fretboard recognition visual. A finished
exercise gets a dark green frame and a finished run a gold one, so both differ
from the light green frame of a single correct note. After the last exercise,
the button becomes New run.

The Settings frame next to Training mode applies to every mode. With "Continue
automatically", the next exercise appears after a countdown when you finish
one, until the run is complete. In Fretboard recognition visual, notes already follow
each other without a pause; the option starts the next run after the countdown
when a run is complete. The "Pause before next" slider sets the countdown from
1 to 10 seconds (default 3). These settings are remembered.

Show hint draws the pattern on the fretboard. The starting note is amber,
other roots are filled green, and the notes of the CAGED chord grip at this
position are filled purple (a grip note just outside the scale box is still
shown). The other scale notes have a thin ring and no fill, even when they are
chord tones outside the grip. Every marker shows its note name and its degree
(R, 2, ♭3, 3, 4, 5, 6, ♭7), and ✓ marks pitches already played. Without the
hint, each correct pitch appears on the fretboard in the same style as soon as
it is played, so the pattern fills up as you go. The microphone hears pitch,
not the string, so a pitch found at two spots in the pattern lights up at both. A "Still to play" line lists the remaining pitches with their
octaves. Guitar pitch can occur at several string
and fret positions. The microphone checks pitch and octave, not the physical
string/fret, fingering or a played chord. It expects one note at a time.

Stop listening pauses progress; Start listening resumes it. Restart exercise
clears progress. Mute a ringing note before starting a restarted assignment.

The five positions use movable CAGED templates, with separate major and minor
chord forms. They follow the chord/scale approach explained in JustinGuitar's
[major pentatonic five-pattern lesson](https://www.justinguitar.com/guitar-lessons/major-pentatonic-the-five-patterns-sc-404)
and [minor pentatonic five-pattern lesson](https://www.justinguitar.com/guitar-lessons/minor-pentatonic-the-5-patterns-sc-304).
These pages are references, not runtime dependencies.

Fretboard recognition visual asks you to play a note on a requested string,
from the strings ticked under Strings to train, with Natural notes or All 12
notes, for a run set by Questions per run. A fretboard (open string through
fret 15) shows a frame around the area that contains the requested note. The frame size is set
with Frame frets (1–16, default 4) and Frame strings (1–6, default 3). The note
is placed at a random position inside the frame, so the frame never reveals
the exact fret. Changing the frame size keeps the current run going. The
requested string is coloured on the fretboard, with the requested note in a
matching label beside it.

Fretboard recognition visual counts mistakes during a run. A wrong note counts once
per pluck; a wrong note that keeps ringing does not count again. Muting a
string can produce brief stray pitches, so wrong notes are ignored for 400 ms
after a correct note and only count once they ring for 120 ms
(`mistakeGraceMs` and `mistakeHoldMs` in `app.js`). Correct notes still count
immediately. New run and
Stop & reset clock set the count back to zero.

Run the checks with Node:

```powershell
node --test "tests/*.test.cjs"
node --check app.js
node --check scale-patterns.js
```

Before using a new version, test the six open strings with a real guitar,
the assigned starting octave, free-order playing, an outside-scale note,
an allowed note outside the pattern's register, a held note, and Stop/Start.
Check the assignment, the frame and the hint on the fretboard at desktop and
phone widths.

Pattern definitions are in `scale-patterns.js`: `templates` stores movable
fret offsets, `build()` calculates MIDI pitches, and `buildAssignment()` derives
the chord form from the assigned string and side. `listNotes()` provides a
readable string/fret/note/octave list.

For example, inspect the A-major assignment on the B string, to the left:

```powershell
node -e "const s=require('./scale-patterns.js'); console.table(s.listNotes(s.buildAssignment('A',2,'left','major')));"
```

Standard tuning begins at E2 (MIDI 40). A1 (MIDI 33) is below the guitar's
range and is never included in an exercise. The MIDI octave conversion is
`Math.floor(midi / 12) - 1`.

## Fretboard recognition click

This mode needs no microphone: answers are given with the mouse or the
keyboard. Its code is in `click-trainer.js`, loaded before `app.js`. Strings,
Natural notes / All 12 notes, Frame frets / strings and Questions per run work
as in Fretboard recognition visual. Tick one or more question types:

1. **Name the note:** a dot marks a position; click its name in the row of
   buttons, or press its key. Keys ignore case; press H before a letter for a
   sharp (H then C = C♯). Only the name counts, not the octave.
2. **Find the note:** click every position of the requested note inside a
   random frame (Frame frets × Frame strings), in any octave.
3. **Nearest note:** a fret is highlighted; on every selected string, click the
   requested note nearest to it within a range of Frame frets (an even number
   gets one more, so the highlighted fret sits in the middle). A string without
   that note in the range needs no click. Equally near notes both count.

With several types ticked, they come in blocks of 3–5 questions of one type.
A wrong answer is a mistake and resets the streak; the question stays until it
is answered.

The response time of every position (string + fret) is kept in the browser
(`guitar-trainer-click-stats`); the last five times count. A question with a
wrong answer counts at least 5 s for its positions. Heatmap pauses the run and
shows every position: green under 2 s, amber 2–5 s, red over 5 s, a dashed
ring when never tried. New questions favour weak and untried positions (red
and untried 4×, amber 2× as often as green), so known notes still appear.

The Scoreboard shows the last run, the current and best streak, and the top
10 runs by average time per question, with the date, the types (for example
"1+3") and mistakes. Reset stats clears times, top 10 and streaks after a
second click to confirm.

## Spell the triad

Triads (R, 3, 5) of major and minor chords. The code is in `triad-trainer.js`,
loaded before `app.js`. The 14 major triad shapes come from page 3 of
`Assets/Guthrie_Trapp_Concepts_ALL_TABS.pdf` ("Triads in Groups Of 3"): C shape
on strings 1–3, 2–4, 3–5 and 4–6; A shape 1–3 and 2–4; G shape 2–4, 3–5 and
4–6; E shape 1–3, 2–4 and 3–5; D shape 1–3 and 4–6. Minor triads lower the 3
by one fret; a shape that would need a fret below 0 is used an octave higher.
A triad is only used when its three strings are ticked under Strings to train.
Natural notes / All 12 notes chooses the roots.

1. **Spell the triad:** a chord name is shown (blue major, orange minor);
   click its R, 3 and 5 in that order on the note buttons, or press the keys
   (H before a letter for a sharp). A wrong note is a mistake; the notes
   already right stay.
2. **Find the chord:** a triad is shown on the fretboard, the root yellow and
   the 3 and 5 purple, without names. Click the chord in the major or minor
   row, or press its letter (M before it for minor, H for a sharp).
3. **Play the triad:** like Train chord with first note, with the microphone.
   Find the root in its frame, then play the three notes one at a time in any
   order. Muted strings show ✕. Type 3 runs on its own: ticking it unticks 1
   and 2, and the other way round.

Types 1 and 2 come in blocks of 3–5 questions. The mode has its own streak,
scoreboard and stats (`guitar-trainer-triad-stats`). Its heatmap is a grid of
chords (roots × major/minor) coloured by average time, and weak chords come up
more often, as in the click mode.
