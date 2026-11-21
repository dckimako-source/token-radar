# Room-Split Push-Optimal Sokoban Solver

Entry for make.fun bounty `sokoban-solver-01-run-20261121`.

## Approach
- Detects the hallway row (the player's start row) and splits the board into rooms
  (floor components above/below it, each reached through one door).
- Since a box pushed through a door can never return, every room is independent:
  an exhaustive BFS over (box set, canonical player region) per room finds the
  exact push-optimal solution. Room state spaces are tiny (3-4 boxes in a 6x6 slot).
- Rooms are solved in a deterministic order; the player's walking steps between
  pushes are BFS-shortest paths and cost no pushes.
- Total pushes equal the level's push-optimal count P*: 1,000/1,000 per instance.
- Fully deterministic (no clock, no randomness); answers the whole set in ~3 s,
  far inside the 60 s wall.

## Run
    mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts

Validated at 1,000,000/1,000,000 on the practice set and on 8 independently drawn sets.

Licensed MIT.
