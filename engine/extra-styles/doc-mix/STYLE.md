# Mixed-Media Science Documentary — Style Guide

> A narrated explainer that never shows its narrator: real footage, 3D or generated stand-ins, code-drawn
> infographics and maps, and close shots of hands, all carried by one voice and one line of subtitles.
> The model is the faceless science channel on TikTok and YouTube ("one astonishing fact, then the proof"),
> with real clips (the client's, open-licence, or other channels' used for commentary).

## 1. Essence

- **One voice carries everything.** A calm, curious narrator talks the whole way; every picture illustrates
  the sentence being spoken. No presenter on camera, no talking head, no hosted intro.
- **Five kinds of picture, taking turns** (never more than ~6 s of one kind in a row):
  1. **Real footage**: nature, space, lab, city, archive — licensed or the client's own.
  2. **Stand-ins for what nobody filmed**: a 3D model or a Google Flow image of the animal, the planet,
     the machine, the past (a whale 40 million years ago, the inside of a star).
  3. **Infographics drawn in code**: scale comparisons (a whale's tongue = a car), counters, timelines,
     cutaways, a globe or a map that turns to the place.
  4. **Hands and objects**: a close shot of an experiment, a model, a sample — never a face.
  5. **Type**: one big fact on screen at the moment it is said (150 t, 27–33 m, 40 million years).
- **Facts are the hook.** Open on the most astonishing true fact in the first 2 s, promise the answer, pay it
  off, end on a short reflection that makes the viewer share it.
- Not a slideshow: every shot moves (a slow push, a pan along the animal, a label drawing on, a counter
  running). Not a news package: no studio graphics, no anchors.

## 2. Frame, length, rhythm

- 16:9 for YouTube and long TikTok (3–6 min), 9:16 for Shorts/Reels (45–90 s): same grammar, bigger type.
- **Rhythm**: cut every 3–6 s on the narration's phrase ends; a fact card holds 1.5–2.5 s; the big reveal gets
  one held shot of 4–6 s with music rising under it.
- **Chapters** for anything over 90 s: 3–5 chapters, each opening with a question card.

## 3. Look

- Deep, natural colour on footage (no heavy filters); infographics in one accent colour on dark navy
  (`#0b1730` ground, `#7fd3ff` lines, white type), thin 2 px strokes, soft glow on the line being drawn.
- Labels sit near what they name with a short leader line; numbers use tabular figures.
- Scale comparisons always show a familiar object (a person silhouette, a bus, a car, a football pitch).
- Subtitles: one line at a time, bottom centre, white with a soft dark shadow, in the film's language; a key
  word may be tinted in the accent colour. Burned in, and also exported as `.srt`.

## 4. Sound

- Narration: **Thai by default** (the client's channel is for a Thai audience), warm and unhurried, about 150 words a
  minute. Make it with `edge-tts` (in `engine/lemo-opuscar/.venv`): `th-TH-PremwadeeNeural` (female) or
  `th-TH-NiwatNeural` (male); keep one voice per channel. It needs the internet; without it, use macOS
  `say -v Kanya`. Use another language only when the brief asks; a recording from the client always wins.
- Subtitles in the narration's language (Thai), timed from the audio (word times from the TTS or a local
  transcription).
- Music: a soft ambient/cinematic bed (Lemo-Opuscar `core/audio`), ducked under the voice, swelling at the
  reveal. A few natural sounds from the footage (water, wind) under the bed.

## 5. Sourcing

- Pictures may come from: the client's own clips (`inputs/`); open sources (Wikimedia Commons, NASA, NOAA, ESA,
  Internet Archive public domain, Pexels, Pixabay); Google Flow; and **clips from other channels and broadcasters
  (YouTube, TikTok, BBC…) used for commentary**, which the client has chosen to allow. For those:
  - fetch them with `yt-dlp` (if it is missing, say so and use other sources; don't install system software);
  - use short excerpts (about 3–15 s each, under a third of the film in total), never a whole video;
  - always transform them: the narration explains or reacts, with labels, infographics, freezes and zooms on top;
  - show the source on screen while a clip plays (small "ที่มา: <channel>" tag), and list it in `CREDITS`;
  - prefer the clip's own sound off; the narration and music carry the film.
  Reaction and commentary use can still get a claim or a strike on some platforms; that risk is the client's call.
- When no clip exists for a beat, make it: a Flow image with a slow move, a 3D stand-in, or an infographic.
- Facts must be true: check numbers against a reliable source and list them in `FACTS.md`.

## 6. Deliverables

- `film/final.mp4`; in `film/deliver/`: the `.srt` subtitles, a **thumbnail** (`thumbnail.jpg`, 1280×720 or
  1080×1920: the one astonishing fact in 2–4 huge words over the hero picture), and `CREDITS`.
