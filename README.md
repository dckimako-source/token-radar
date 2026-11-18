# Token Radar

Token Radar is a dev-phase entry for the `token-radar-01` competition. It turns the
frozen DefiLlama snapshot in `input/snapshot.json` into a ranked board of pre-token
protocols, an implied-value estimate for each, and a concrete farm plan you can act on.

## What it does

- **Scores every protocol in the snapshot** (not just the watchlist) using a
  transparent scoring model in `lib/model.ts`: TVL size and momentum, age, category
  fit, chain spread, and whether the protocol still has no token all feed a weighted
  score with per-factor explanations.
- **Estimates implied value** for pre-token protocols: FDV scenarios derived from
  comparable token-bearing protocols (TVL/FDV ratios), with a fair-value range and
  an FDV/TVL sanity check.
- **Builds a farm plan per protocol** (`farm_steps`): ordered, concrete steps — which
  chains to use, what volume/liquidity actions matter, and what to watch for before a
  token launch.
- **Renders a dashboard** (`dashboard/`): a static, zero-dependency app served from
  `output/dashboard` that reads `output/data.js` — sortable board, per-protocol detail
  view with the full dossier, and filtering (early-only, category, chain).

## Running it

```
mkdir -p input output
cp <kit>/input/snapshot.json input/
node main.ts --input input/snapshot.json --output output
```

Outputs land in `output/`: `board.json` (ranked rows), `dossier.json` (embedded
screenshots), `data.js` (dashboard payload), `dashboard/` and `screenshots/`.

Open `output/dashboard/index.html` in a browser to read the board.

## Layout

- `main.ts` — CLI entry: load snapshot → score → write outputs.
- `lib/model.ts` — scoring model, implied-value estimate, farm-plan logic.
- `dashboard/` — source of the static dashboard (copied into `output/dashboard/`).
- `vendor/makefun-board.ts` — board rendering helper from the kit.

## License

MIT — see `LICENSE`.
