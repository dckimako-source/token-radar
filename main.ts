// Sokoban push-optimal solver: room decomposition + exhaustive BFS per room.
// Level shape: one-square-wide hallway row (where @ starts), rooms above/below,
// each opening onto the hallway through one door. Boxes never leave their room,
// so a level's push-optimal count is the sum of its rooms' optima.
// Local run: mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node entry/main.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

type Cell = number; // index = y * W + x
const DIRS: Array<[number, number, string]> = [
  [0, -1, 'u'],
  [0, 1, 'd'],
  [-1, 0, 'l'],
  [1, 0, 'r'],
];

interface Room {
  cells: Set<Cell>;       // room floor cells (boxes count as floor), incl. door cell
  hallAdj: Cell[];        // hallway cells adjacent to the door cell
  door: Cell;
}

function parse(level: string) {
  const rows = level.split('\n').filter((r) => r.length > 0);
  const H = rows.length;
  const W = Math.max(...rows.map((r) => r.length));
  const grid: string[] = new Array(W * H).fill('#');
  for (let y = 0; y < H; y++)
    for (let x = 0; x < rows[y].length; x++) grid[y * W + x] = rows[y][x];
  const isFloor = (c: Cell) => {
    const ch = grid[c];
    return ch !== undefined && ch !== '#';
  };
  let start = -1;
  const boxes = new Set<Cell>();
  const goals = new Set<Cell>();
  for (let c = 0; c < W * H; c++) {
    const ch = grid[c];
    if (ch === '@') start = c;
    else if (ch === '$' || ch === '*') boxes.add(c);
    if (ch === '.' || ch === '*') goals.add(c);
  }
  return { rows, H, W, grid, isFloor, start, boxes, goals };
}

/** Hallway row = the row of the player start. Rooms = floor components excluding that row. */
function findRooms(p: ReturnType<typeof parse>): Room[] {
  const { W, isFloor, start, grid } = p;
  const hallY = Math.floor(start / W);
  const seen = new Set<Cell>();
  const rooms: Room[] = [];
  for (let c = 0; c < grid.length; c++) {
    if (seen.has(c) || !isFloor(c)) continue;
    if (Math.floor(c / W) === hallY) continue;
    // flood fill this component
    const cells = new Set<Cell>();
    const stack = [c];
    seen.add(c);
    while (stack.length) {
      const cur = stack.pop()!;
      cells.add(cur);
      for (const [dx, dy] of DIRS) {
        const n = cur + dy * W + dx;
        const ny = Math.floor(n / W);
        if (ny < 0 || ny >= p.H) continue;
        if (Math.abs(n - cur) !== (dy === 0 ? 1 : W)) continue; // guard wrap
        if (seen.has(n) || !isFloor(n) || ny === hallY) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    // door: a cell of the component adjacent (vertically) to the hallway row
    let door = -1;
    const hallAdj: Cell[] = [];
    for (const cell of cells) {
      const y = Math.floor(cell / W);
      if (y === hallY - 1 || y === hallY + 1) {
        const hallCell = cell + (y === hallY - 1 ? W : -W);
        if (Math.floor(hallCell / W) === hallY && isFloor(hallCell)) {
          if (door === -1 || cell < door) door = cell;
          hallAdj.push(hallCell);
        }
      }
    }
    if (door === -1) continue; // sealed region, ignore
    rooms.push({ cells, hallAdj: [...new Set(hallAdj)].sort((a, b) => a - b), door });
  }
  return rooms;
}

/** Cells the player can reach from `from` given boxes, restricted to `bounds`. */
function region(from: Cell, boxes: Set<Cell>, bounds: Set<Cell>): Set<Cell> {
  const vis = new Set<Cell>([from]);
  const stack = [from];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const [dx, dy] of DIRS) {
      const n = cur + dy * W0 + dx;
      if (!bounds.has(n) || boxes.has(n) || vis.has(n)) continue;
      vis.add(n);
      stack.push(n);
    }
  }
  return vis;
}
let W0 = 0; // grid width, set per level

interface Push { box: Cell; dir: number; letter: string; playerBefore: Cell }

/**
 * Exhaustive BFS over (box set, canonical player region) inside one room.
 * Returns the minimal-push sequence, or null. Player starts at `startCell`
 * (door cell, or a hallway cell adjacent to a boxed-up door).
 */
function solveRoom(
  room: Room,
  boxesIn: Set<Cell>,
  goals: Set<Cell>,
  startCell: Cell,
): Push[] | null {
  const R = room.cells;
  // bounds include the room plus hallway cells adjacent to the door (entry approaches)
  const bounds = new Set<Cell>([...R, ...room.hallAdj]);
  if (!bounds.has(startCell)) return null;
  if (boxesIn.has(startCell)) return null;

  const keyOf = (bs: Set<Cell>, rep: number) =>
    [...bs].sort((a, b) => a - b).join(',') + '|' + rep;

  const startBoxes = new Set(boxesIn);
  const startRegion = region(startCell, startBoxes, bounds);
  const startKey = keyOf(startBoxes, Math.min(...startRegion));
  const start = { boxes: startBoxes, rep: Math.min(...startRegion), parent: null as Node | null, push: null as Push | null };
  interface Node { boxes: Set<Cell>; rep: number; parent: Node | null; push: Push | null }
  let frontier: Node[] = [start];
  const visited = new Set<string>([startKey]);
  const isGoal = (bs: Set<Cell>) => {
    if (bs.size !== goals.size) return false;
    for (const b of bs) if (!goals.has(b)) return false;
    return true;
  };
  if (isGoal(startBoxes)) return [];

  while (frontier.length) {
    const next: Node[] = [];
    for (const node of frontier) {
      // region membership for this canonical state
      const regCells = region(node.rep, node.boxes, bounds);
      for (const b of node.boxes) {
        for (const [dx, dy, letter] of DIRS) {
          const p = b - dy * W0 - dx; // player cell before push
          const t = b + dy * W0 + dx; // box cell after push
          if (!regCells.has(p) || node.boxes.has(p)) continue;
          if (!R.has(t) || node.boxes.has(t)) continue; // box must stay in the room
          const nb = new Set(node.boxes);
          nb.delete(b);
          nb.add(t);
          // cheap deadlock prune: box in a wall corner, off goal
          if (!goals.has(t) && isCorner(t, R)) continue;
          const nreg = region(b, nb, bounds); // player ends where the box was
          const rep = Math.min(...nreg);
          const key = keyOf(nb, rep);
          if (visited.has(key)) continue;
          visited.add(key);
          const child: Node = { boxes: nb, rep, parent: node, push: { box: b, dir: dy * W0 + dx, letter, playerBefore: p } };
          if (isGoal(nb)) {
            // reconstruct
            const seq: Push[] = [];
            let cur: Node | null = child;
            while (cur && cur.push) {
              seq.push(cur.push);
              cur = cur.parent;
            }
            return seq.reverse();
          }
          next.push(child);
        }
      }
    }
    frontier = next;
  }
  return null;
}

function isCorner(c: Cell, R: Set<Cell>): boolean {
  const x = c % W0;
  const up = !R.has(c - W0), down = !R.has(c + W0);
  const left = x === 0 || !R.has(c - 1), right = x === W0 - 1 || !R.has(c + 1);
  return (up && left) || (up && right) || (down && left) || (down && right);
}

/** Walk path for the player from `from` to `to` avoiding boxes/walls; returns move letters. */
function walk(from: Cell, to: Cell, boxes: Set<Cell>, p: ReturnType<typeof parse>): string | null {
  if (from === to) return '';
  const { W, H, isFloor } = p;
  const prev = new Map<Cell, [Cell, string]>();
  const q: Cell[] = [from];
  prev.set(from, [from, '']);
  while (q.length) {
    const cur = q.shift()!;
    for (const [dx, dy, letter] of DIRS) {
      const n = cur + dy * W + dx;
      const ny = Math.floor(n / W);
      if (ny < 0 || ny >= H || Math.abs(n - cur) !== (dy === 0 ? 1 : W)) continue;
      if (!isFloor(n) || boxes.has(n) || prev.has(n)) continue;
      prev.set(n, [cur, letter]);
      if (n === to) {
        const out: string[] = [];
        let c = n;
        while (c !== from) {
          const [pv, l] = prev.get(c)!;
          out.push(l);
          c = pv;
        }
        return out.reverse().join('');
      }
      q.push(n);
    }
  }
  return null;
}

function solve(level: string): string {
  const p = parse(level);
  W0 = p.W;
  const rooms = findRooms(p);
  // Every box and goal must sit in a room for the decomposition to be sound.
  const allRoomCells = new Set<Cell>();
  for (const r of rooms) for (const c of r.cells) allRoomCells.add(c);
  for (const b of p.boxes) if (!allRoomCells.has(b)) return globalFallback(p);
  for (const g of p.goals) if (!allRoomCells.has(g)) return globalFallback(p);

  let player = p.start;
  const boxes = new Set(p.boxes);
  const out: string[] = [];
  // deterministic room order: by door index
  const ordered = [...rooms].sort((a, b) => a.door - b.door);
  for (const room of ordered) {
    const roomBoxes = new Set<Cell>();
    for (const b of boxes) if (room.cells.has(b)) roomBoxes.add(b);
    const roomGoals = new Set<Cell>();
    for (const g of p.goals) if (room.cells.has(g)) roomGoals.add(g);
    // start cell: door if free, else a hallway cell adjacent to the door
    let startCell = room.door;
    if (roomBoxes.has(room.door)) {
      startCell = room.hallAdj[0];
    }
    const seq = solveRoom(room, roomBoxes, roomGoals, startCell);
    if (process.env.MAKEFUN_DEBUG) console.error('room door', room.door, 'cells', room.cells.size, 'boxes', roomBoxes.size, 'goals', roomGoals.size, 'start', startCell, 'seq', seq ? seq.length : null);
    if (seq === null) return globalFallback(p);
    // walk to each push position, then apply pushes
    let cur = player;
    for (const push of seq) {
      const w = walk(cur, push.playerBefore, boxes, p);
      if (w === null) return globalFallback(p);
      out.push(w);
      boxes.delete(push.box);
      boxes.add(push.box + push.dir);
      cur = push.box;
      out.push(push.letter);
    }
    player = cur;
  }
  return out.join('');
}

/** Fallback: exhaustive push-BFS over the whole level (only for odd shapes). */
function globalFallback(p: ReturnType<typeof parse>): string {
  const { W, H, isFloor, start, boxes: b0, goals } = p;
  W0 = W;
  const floors = new Set<Cell>();
  for (let c = 0; c < W * H; c++) if (isFloor(c)) floors.add(c);
  interface Node { boxes: Set<Cell>; rep: number; parent: Node | null; push: Push | null }
  const regionOf = (from: Cell, bs: Set<Cell>) => region(from, bs, floors);
  const startReg = regionOf(start, b0);
  const isGoal = (bs: Set<Cell>) => {
    if (bs.size !== goals.size) return false;
    for (const b of bs) if (!goals.has(b)) return false;
    return true;
  };
  if (isGoal(b0)) return '';
  const keyOf = (bs: Set<Cell>, rep: number) => [...bs].sort((a, b) => a - b).join(',') + '|' + rep;
  let frontier: Node[] = [{ boxes: new Set(b0), rep: Math.min(...startReg), parent: null, push: null }];
  const visited = new Set<string>([keyOf(b0, Math.min(...startReg))]);
  const LIMIT = 4_000_000;
  while (frontier.length && visited.size < LIMIT) {
    const next: Node[] = [];
    for (const node of frontier) {
      const reg = regionOf(node.rep, node.boxes);
      for (const b of node.boxes) {
        for (const [dx, dy, letter] of DIRS) {
          const pl = b - dy * W - dx;
          const t = b + dy * W + dx;
          if (!reg.has(pl) || node.boxes.has(pl)) continue;
          if (!floors.has(t) || node.boxes.has(t)) continue;
          if (!goals.has(t) && isCornerGlobal(t, floors)) continue;
          const nb = new Set(node.boxes);
          nb.delete(b); nb.add(t);
          const nreg = regionOf(b, nb);
          const rep = Math.min(...nreg);
          const key = keyOf(nb, rep);
          if (visited.has(key)) continue;
          visited.add(key);
          const child: Node = { boxes: nb, rep, parent: node, push: { box: b, dir: dy * W + dx, letter, playerBefore: pl } };
          if (isGoal(nb)) {
            const parts: string[] = [];
            let cur: Node | null = child;
            let curPos = start;
            const bset = new Set(b0);
            const moves: string[] = [];
            // rebuild with walks
            const seq: Push[] = [];
            while (cur && cur.push) { seq.push(cur.push); cur = cur.parent; }
            seq.reverse();
            let pos = start;
            for (const push of seq) {
              const w = walk(pos, push.playerBefore, bset, p);
              if (w === null) return '';
              moves.push(w);
              bset.delete(push.box);
              bset.add(push.box + push.dir);
              pos = push.box;
              moves.push(push.letter);
            }
            void parts; void curPos;
            return moves.join('');
          }
          next.push(child);
        }
      }
    }
    frontier = next;
  }
  return '';
}

function isCornerGlobal(c: Cell, floors: Set<Cell>): boolean {
  const x = c % W0;
  const up = !floors.has(c - W0), down = !floors.has(c + W0);
  const left = x === 0 || !floors.has(c - 1), right = x === W0 - 1 || !floors.has(c + 1);
  return (up && left) || (up && right) || (down && left) || (down && right);
}

for (const id of readdirSync(I).sort()) {
  const level = readFileSync(join(I, id, 'level.txt'), 'utf8');
  const moves = solve(level);
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
