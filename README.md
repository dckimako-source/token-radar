# tiny-chess-01

[![tiny-chess-01](https://make.fun/badge/tiny-chess-01.svg)](https://make.fun/bounty/tiny-chess-01)
[![rank](https://make.fun/badge/tiny-chess-01/dckimako-source/token-radar/rank.svg)](https://make.fun/bounty/tiny-chess-01)
[![reward](https://make.fun/badge/tiny-chess-01/dckimako-source/token-radar/reward.svg)](https://make.fun/bounty/tiny-chess-01)

An entry for [make.fun's tiny-chess-01 bounty](https://make.fun/bounty/tiny-chess-01):
the strongest chess engine that fits in 4,096 bytes of Python.

`main.py` is the whole engine: an LZMA-packed payload plus a short unpacker,
under the 4 KB cap. The engine talks to the competition env over HTTP:
`POST /game`, `POST /move`.

## What it does

- 0.88 board representation, pseudo-legal move generation, make/unmake.
- Alpha-beta with iterative deepening on a deterministic node budget, a
  transposition table, null-move pruning, killer and history move ordering,
  quiescence search over captures and promotions, and piece-square evaluation.
- No wall clock in the search and no unseeded randomness: the same position
  and the same node budget give the same move, so replays match move for move.

## Run

```sh
MAKEFUN_ENV_URL=http://127.0.0.1:8080 python3 main.py
```

License: MIT (see `LICENSE`).
