---
name: craft
description: The craft of a finished film — ducking music under speech, checked whole-film edits that can be taken back, quality checks on the rendered picture, beats. Use its commands instead of patching film.html by hand for what they cover.
---

# Craft

Commands of this plugin are run as `openfilm craft <command>`. Each `--help` says its options.

## Ducking: music under the voice

A sound that ducks under others is declared on its clip in film.html — write it, do not re-cut the music:

```html
<audio id="music" src="assets/music.mp3#t=0,60" volume="0.9"
       data-craft-duck='{"speech":-17,"pause":-13,"ratio":3}'></audio>
```

Once declared, the gain is measured of what it follows and ridden into the film's sound when the film is
rendered or looked at — nothing more to run. What it takes (each optional, the defaults are a voice-over bed's):

- `under` — the clip ids it follows; without it, every other sound of the film
- `speech` — its gain while they speak, dB (-17); `pause` — between their words, dB (-13)
- `ratio` — how hard a voice over `threshold` dBFS (-40) pushes it down (3)
- `attack` / `release` / `hold` — seconds down (0.04), back up (0.35), held after a word (0.15)
- `from` / `to` — the film seconds it ducks within (default: all of it); outside it plays at full
- `over` — `[[from, to, dB], …]` windows set to a level whatever is said (a title, a climax)

`openfilm craft duck` checks what the film declares: every parameter read, what each clip follows, what is
wrong — run it after writing or changing a declaration, before rendering.

## Editing: operations, not text patches

`openfilm craft edit` changes the film by what it is — clips, times, tracks — checked whole before anything is
written, and kept so it can be taken back. Prefer it over patching film.html by hand for what it covers:

```
openfilm craft edit '[{"op":"trim","clip":"vo-1","from":0.3,"to":4.1},{"op":"fade","clip":"mu-1","in":0.3,"out":1.6}]' --why "tighten the opening"
openfilm craft edit --undo        openfilm craft edit --log
```

craft's own compound operations: `trim` (the part of its file a clip plays), `fade`, `attr` (a data-* attribute —
how ducking is declared), `replace` (another file, same kind), `shift` (everything from a film second on later,
optionally stretching the clip across it), `ripple` (the clip longer or shorter at its end, what follows moves).
Every operation Studio knows passes through as it is: `move`, `insert`, `remove`, `split`, `props` (at start end
volume speed box overrides link fade motion track), `fields`, `track`, `reorder`, `stage`, `keyframes`, `captions`.
`--dry-run` says what would be written without writing. `--help` lists them all.

## Checking: the rendered film's motion

`openfilm craft check out.mp4` reads a render's motion on small grey frames: `hold` (the picture barely changes
for seconds), `drift` (moving too slowly to read as motion), `move` (one pan that never lands), `scroll` (moving
mostly up or down on end). Render first, then check; `--footage` excuses long moves in footage that moves by
itself; `--json` for reading in a tool.

## Beats: cutting to the music

`openfilm craft beats song.mp3` reads the beat grid — BPM, every beat, downbeats, sections, accents, where to
come in — and writes `song.beats.json` beside it (once, again when the file changes). Cut on downbeats, animate
on beats: a page fetches the JSON and moves with the music.

(More as they are ported: see PORTING.md at the repository root.)
