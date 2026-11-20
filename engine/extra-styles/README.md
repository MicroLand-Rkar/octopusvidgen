# Extra styles

Styles that come from skills other than Lemo-Opuscar. Each folder holds a `style.json`
(same fields as the library's, plus `skill`: the folder name under `.claude/skills/`) and a
`poster.jpg`. The server lists them with the library's styles.

- `line-art-ink` — from [line-art-animation](https://github.com/JDhruv14/line-art-animation)
  (MIT, git submodule `engine/line-art-animation/`). Poster from its `media/day.png`.
- `onetake-launch`, `onetake-demo`, `onetake-concept` — the "Product Launch · onetake" category, from
  [onetake](https://github.com/feitangyuan/onetake) (git submodule `engine/onetake/`).
  **PolyForm Noncommercial 1.0.0: free for noncommercial use only**; films for a client or a business need
  onetake Pro's commercial licence. Posters are frames from onetake's own sample films (same licence).
  Its Python scripts run from `engine/onetake/.venv` (playwright, numpy, scipy, pillow, fonttools, brotli, soundfile).
- `hf-captions`, `hf-vertical`, `hf-music` — the "HyperFrames" category, from
  [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache 2.0; skills `hyperframes`, `hyperframes-cli`,
  `hyperframes-registry`, `media-use` from the git submodule `engine/hyperframes/skills/`). Jobs run its CLI (0.9.69) with telemetry off and
  free local tools only: no HeyGen sign-in, credits, Pro features or desktop app. Posters drawn for this site.
- `logo-reveal`, `lottie-anim` — the "Logo & Lottie" category, from
  [pixel2motion](https://github.com/nolangz/pixel2motion) (MIT, git submodule `engine/pixel2motion/`) and
  [text-to-lottie](https://github.com/diffusionstudio/lottie) (MIT, git submodule `engine/text-to-lottie/`: the skill plus its Skottie player).
  Posters drawn for this site. Extra deliverables (SVG, HTML, Lottie JSON) go in `film/deliver/` and show on the film page.
- `ad-*` (13 styles) — the "anidoodle" category, from [anidoodle](https://github.com/alexgreensh/anidoodle)
  (Apache 2.0, git submodule `engine/anidoodle/`, skill at `skills/anidoodle/`), only the styles the library above doesn't already cover; each style.json names its
  `engine_style`. Posters are tiles from anidoodle's own style sheet (same licence).
- `arch-diagram` — in "Line Diagrams", from [lanshu-animated-architecture-diagram](https://github.com/cclank/lanshu-animated-architecture-diagram)
  (MIT, git submodule `engine/arch-diagram/`, Pillow only). Poster drawn for this site.
- Writing aids, not styles: ten skills from [screenwriting-skills](https://github.com/jtydhr88/screenwriting-skills)
  (MIT, git submodule `engine/screenwriting/`, skills at `plugins/screenwriting/skills/`) linked into `.claude/skills/` for story and dialogue work in every job.
