# Contexa — Your context engine

New 40-second commercial. White backgrounds, Manrope/Inter typography, green brand accents, animated source/engine diagrams, a real Contexa interface capture, natural-speed neural narration, and a newly composed backing score.

## Files

- `Contexa-40s-Commercial.mp4`: 1920 × 1080, 30 fps H.264/AAC master with fast-start playback.
- `Storyboard.jpg`: key shots from the finished design.
- `Contexa-Poster.jpg`: campaign thumbnail.
- `Contexa-Captions.srt`: narration captions.
- `film.html`: deterministic, editable vector/canvas motion graphics.
- `capture_product.py`: captures actual local frontend components with a synthetic demo API fixture.
- `produce_audio.py`: narration, music, sound accents, and audio mix.
- `render_film.py`: renders frames and exports the MP4.

## Creative structure

| Time | Viewer experience |
| --- | --- |
| 0–4.5s | Immediate pain: “Still struggling to give Claude the right context?” Floating source files surround a request for missing context. |
| 4.5–8.8s | Sources converge into Contexa. Brand and context-engine positioning appear. |
| 8.8–14.5s | “Your whole project. One interface.” Repository source flows through the inspection/mapping engine into code, model, and architecture outputs. Narration explicitly introduces the unified project view. |
| 14.5–20s | Camera moves into the actual task-entry UI. An access-control change is typed into the form. |
| 20–26s | Relevant routes, auth contracts, and Prisma definitions move into a task-focused pack. |
| 26–31s | Actual task-pack UI, an example budget, a copy action, and a visual handoff to Claude. |
| 31–36s | Show the repeatable base-pack/task-pack workflow and both copy/paste and MCP. |
| 36–40s | “Your repo. One real task.” and a clear “Try Contexa” call to action. |

The displayed Orbit project is synthetic. The screenshots render Contexa's existing frontend components with fixture data; they are not an end-to-end ingestion benchmark. Engine diagrams and the Claude handoff are motion-graphic explanations. Source and model selection behavior is based on the repository's `PRODUCTION.md` and context-pack interface. The example token budget and pack size are not savings claims.

“Your context engine for AI” is used as the positioning. No unverified “first ever” claim, savings percentage, customer testimonial, pricing offer, or guaranteed code-generation result is included.

## Reference study

Studied the official [Granola launch announcement](https://www.granola.ai/blog/announcement) and its [note-enhancement motion demo](https://www.granola.ai/blogImages/enhancing_animation_16x9.mp4), plus [Tella's homepage product video](https://www.tella.com/marketing-site/media/hero-product-demo.mp4). Local frame sheets in `research/` were used to inspect visual progression.

Useful principles applied: establish one recognizable input; show its transformation; keep UI on a clean stage; concentrate attention through framing; change composition when the workflow changes; leave a clear next action. These references informed the visual approach. Their artwork, soundtracks, and UI were not reused in the commercial. No ad-conversion or revenue claims are made about the references.

## Sound

New narration uses `en-US-AndrewMultilingualNeural`, at its natural speed. `assets/timings.json` records the actual duration of every performance. The electronic score and micro-impacts are synthesized from original code without stock samples. The final mix is normalized for online playback.

## Rebuild

Python dependencies: `Pillow`, `numpy`, `playwright`, `imageio-ffmpeg`, `edge-tts`. Install the Playwright Chromium runtime. Font files are locally bundled Google Fonts distributions; see the accompanying OFL license files in `assets/`.

Start the existing frontend on `127.0.0.1:5179`, then run:

```powershell
python artifacts/contexa-ad-v2/capture_product.py
python artifacts/contexa-ad-v2/produce_audio.py
python artifacts/contexa-ad-v2/render_film.py --preview
python artifacts/contexa-ad-v2/render_film.py
```

Nothing is published. The ad destination should be the actual Contexa trial/signup page when the campaign is placed. A public URL was not supplied, so no invented URL is baked into the video.
