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

(More as they are ported: see PORTING.md at the repository root.)
