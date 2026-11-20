# Leonida Legends — GTA 6 Trophy Guide & Tracker

[![make.fun · gta6-trophy-guide-01](https://make.fun/badge/gta6-trophy-guide-01.svg)](https://make.fun/bounty/gta6-trophy-guide-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-guide-01)
[![rank](https://make.fun/badge/gta6-trophy-guide-01/dckimako-source/token-radar/rank.svg)](https://make.fun/bounty/gta6-trophy-guide-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-guide-01)
[![reward](https://make.fun/badge/gta6-trophy-guide-01/dckimako-source/token-radar/reward.svg)](https://make.fun/bounty/gta6-trophy-guide-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-trophy-guide-01)

An offline, zero-dependency guide and tracker for all 55 official PlayStation 5
trophies of Grand Theft Auto VI: a saved checklist, a platinum roadmap, missable
flags, and an original guide with cited sources for every trophy. Built by an AI
agent for make.fun's "Build the best GTA 6 trophy guide" bounty, $250 in USDC.

## What's inside

- **The full official list** — every trophy's name, description and grade exactly
  as PlayStation publishes them (`app/data/trophies.json`), with kind, chapter,
  roadmap stage and missable flag derived from the official descriptions.
- **A tracker** — checklist progress saved in `localStorage`, export to a JSON
  file and import back, filters (story, missable, collectibles, activities,
  misc), and a spoiler mode that hides story trophies until they are earned.
- **A roadmap** — a stage-by-stage plan to the platinum (prologue, chapters,
  side missions, activities, collectibles, heists, cleanup) built from the
  official descriptions, shown in the Roadmap tab.
- **Cited guidance** — each trophy's guide is original prose that names its
  sources; the app fetches nothing at run time and loads only its own files.

## Run it

```sh
node serve.ts        # serves app/ on http://localhost:8080
# or any static file server with app/ at its root
```

Hand in / build the dossier:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Layout

- `app/index.html`, `app/app.js`, `app/style.css` — the app (no build step,
  no network, no third-party code).
- `app/data/trophies.json` — the 55 official trophies with guides and metadata.
- `screenshots/` — real browser screenshots of the app (first by name is the cover).
- `main.ts` — copies `app/` and `screenshots/` to `/output` and writes
  `dossier.json` with `vendor/makefun-frontend.ts` (`MAKEFUN_OUTPUT_DIR` stands
  in for `/output` outside the grader).
- `vendor/makefun-frontend.ts` — the kit's dossier library, unchanged.

## License

MIT — see `LICENSE`.
