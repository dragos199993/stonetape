# Stonetape Brand Sheet

One page. If a decision isn't covered here, ask: "would a 1984 tape deck do this?"

## The idea

Stonetape is named after the Stone Tape Theory: places record events and replay
them, endlessly, like magnetic tape. Everything in the brand expresses one
sentence: **recorded events, replayed faithfully.** The product does it with
HTTP; the brand does it with VCR language.

## Logo

| File | Use |
|---|---|
| `assets/brand/mark.svg` | Primary mark: cassette on dark rounded square. GitHub/npm/X avatars, favicons. |
| `assets/brand/cassette.svg` | Glyph only, transparent. For placement on brand-dark surfaces. |
| `assets/brand/avatar.png` | 512px render of the mark for platforms that need raster. |

Rules: don't recolor the reels (left is always REC red), don't add detail
(the mark must survive 16px), don't put the cream glyph on light backgrounds.

## Color

Warm stone-dark neutrals, one loud accent. OKLCH is canonical; hex for tools
that need it.

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| bg | `oklch(0.16 0.01 75)` | `#17130e` | Surfaces, terminal background |
| bg-inset | `oklch(0.125 0.008 75)` | `#100d09` | Screens, code blocks |
| text | `oklch(0.92 0.014 80)` | `#e8e2d4` | Body text, glyph cream |
| text-muted | `oklch(0.7 0.02 78)` | `#a89d8a` | Secondary text |
| rec | `oklch(0.6 0.22 27)` | `#d43d2a` | THE accent: REC dot, CTAs, badge color |
| osd-green | `oklch(0.8 0.15 148)` | `#7fd196` | Success states only (phosphor) |

The 60-30-10 rule is law: REC red stays rare or it stops meaning "recording."
Never cyan or purple on dark. Never pure black or pure white.

## Type

| Face | Where |
|---|---|
| Big Shoulders Display | Headlines. Uppercase, tight leading. |
| Atkinson Hyperlegible | Body copy. |
| Fragment Mono | Code. |
| VT323 | OSD labels ONLY: REC, timecodes, tape counters. Never body text. |

## Motifs (the vocabulary)

`● REC` · `▶ PLAY` · `⏸` · `■ STOP` · `◀◀ REWIND` · `SP 00:00:00:00` ·
`C-90` · `SIDE A / SIDE B` · `TAKE 01` · `STANDBY` · `END OF TAPE`

Use them where they carry meaning (recording, replaying, position, chapters).
Decoration that is not tape-native gets cut.

## Voice

Dry, exacting, provable. Every claim must be backed by the README or a test.
No em dashes, anywhere. No adjectives that can't be measured. The brand can
whisper a joke ("You're on the tape") but never winks twice in a row.

## Registers: loud vs quiet

| Surface | Register |
|---|---|
| Landing page (stonetape.dev) | Loud. Full haunted-tape treatment: scanlines, CRT, glitches. |
| README / npm | Quiet. Two winks max (CI readout block, `■ STOP · END OF TAPE`). Content first. |
| CLI / test output | Quiet. `● REC` summary line, dim metadata, colors respect NO_COLOR and non-TTY. |
| Error messages | Plain. Zero theming. The mismatch explanation IS the product; nothing may compete with it. |

## Terminal

- Demo GIFs are rendered from `assets/demo.tape` (vhs) with the brand theme
  embedded in the tape file. Re-render with `vhs assets/demo.tape`.
- CLI colors live in `src/ui/style.ts`: REC red, dim metadata, green additions,
  yellow drift. Auto-disabled when piped, in CI, or under NO_COLOR.
