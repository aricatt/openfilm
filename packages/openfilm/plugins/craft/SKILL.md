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

## Speed curves: fast, then slow, then fast

A video clip's film time shared out unevenly over the same part of its file — declared on the clip:

```html
<video id="v1" src="shot.mp4#t=0,8" data-craft-ramp="hero"></video>
```

Presets: `montage` (fast in, slow middle, fast out), `hero` (a slow-downed peak), `bullet` (a held slow stretch),
`flash-in` / `flash-out` — or the points themselves: `'[[0,1],[0.5,0.18],[1,1]]'` (u the share along the clip,
speed relative, mean normalized to 1). The clip stays as long on the film and shows the same source span, so
trims, moves and cuts keep their times. A curved clip is not heard: its sound would stretch unevenly. Write or
change one with craft edit's `attr` operation, then `openfilm craft ramp` checks every declaration reads.

(More as they are ported: see PORTING.md at the repository root.)

## Lines said over a still picture (死句)

`openfilm craft check out.mp4 --lines captions.vtt` crosses the film's caption cues (WebVTT, on the film's
time) with the stillness read: a line the picture is still for 90% of is dead, and dead lines past a tenth
of all lines fail the craft bar. One held moment with a line over it can be meant — a film of them reads
as a slideshow with a voiceover.

## Cuts that snap to silence

`openfilm craft edit '[…]' --snap` moves split/trim cuts to the nearest silence first (±0.6 s — a split to
its middle, a trimmed edge keeping a 0.1 s breath), so speech is never cut inside a word. Where there is no
silence near it is said in one line and the cut stands — never refused. Use it when cutting speech; clips
playing at other than their own speed are left alone.

## Freeze frames

`openfilm craft still video.mp4 12.4 assets/freeze.jpg` draws one frame of a video out as a JPEG — accurate
to the moment, and the file's last moment gives the last frame before it rather than failing. Then place it:

```
openfilm craft edit '{"op":"insert","src":"assets/freeze.jpg","at":12.4,"len":2}' --why "freeze on the reveal"
```

## Vision checks (密字 / 字不停)

`openfilm craft check out.mp4 --vision` reads one frame a second with the configured model: 密字 (a screen of
small print, few words big enough to read, for seconds on end) and 字不停 (words that never settle long enough
to read). Configure once: `openfilm craft llm-config <base-url> <api-key> [model]` — written to the user's own
~/.config/craft/llm.json, never the project, or CRAFT_LLM_BASE_URL / CRAFT_LLM_API_KEY in the environment.
Each frame is one model call — a minute of film is sixty; mind what the endpoint charges.
