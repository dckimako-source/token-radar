# Astral Warden

An original top-down arena survival shooter for desktop Chrome. Fly your warden with **WASD**,
aim with the mouse, hold the left button to fire, and hold the line against waves of the swarm.
Destroyed enemies drop green cores: collect them to level up and choose one of three upgrade
cards. A combo multiplier rewards fast kills, brutes arrive every fourth wave, and the run ends
on a results screen with your score, best score and a restart.

- **Controls:** WASD to move, mouse to aim, hold left button to fire, Space to pause, M to mute,
  Enter / click to advance screens.
- **Goal:** survive as many waves as you can and set a high score.
- **No network, no build step:** everything under `game/` is static; every sound is synthesized
  with the Web Audio API and all art is drawn on canvas. Serve `game/` with any static file
  server and open `game/index.html`.

## Layout

- `game/` — the playable game, plain static ES modules, no dependencies.
- `screenshots/` — four real renders of the game: title, play, upgrade choice, results.
- `main.ts` — the submission program (Node 22, standard library only): copies `game/` and
  `screenshots/` to `/output` and writes `dossier.json` with `buildDossier` from
  `vendor/makefun-game.ts`.
- `vendor/makefun-game.ts` — the kit's dossier library, unchanged.

## Development

```sh
node serve.ts            # serve game/ at http://localhost:8080
node ../smoke.mjs        # headless 90-second scripted playthrough of the simulation
```

## License

MIT — see [LICENSE](LICENSE).
