// The token radar's scoring and output stages.
//
// One invocation scores the sealed snapshot, validates the ranked board, writes the board and the
// dashboard's data payload, mirrors the static assets, and finally writes the dossier. The dossier is
// deliberately last: the scorer rebuilds it from the finished output directory and compares bytes.
//
// Argument parsing, reporting and orchestration live in lib-cli.ts. `main` is re-exported here so the
// original `import { main } from './lib-main.ts'` entry keeps working unchanged.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardRow, RadarData, Snapshot } from './lib/model.ts';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

export { main } from './lib-cli.ts';

/** Where this entry lives: the source of the dashboard/ and screenshots/ folders. */
const entryDir = fileURLToPath(new URL('.', import.meta.url));

/** The gate's text cap: text that exceeds it is refused, not silently trimmed. */
const TEXT_CAP_BYTES = 65_536;
/** The gate's image caps: at most four screenshots, each within half a megabyte. */
const IMAGE_CAPS = { max: 4, max_bytes: 524_288 };
/** The gate's dashboard caps, passed through to the dossier builder. */
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
/** Plain file names only: no paths, no dot-files, 1 to 128 characters. */
const VALID_IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Parse, score and gate-check the snapshot before a single output file is written. */
export function scoreSnapshot(file: string): { snapshot: Snapshot; board: BoardRow[]; radar: RadarData } {
  const snapshot = parseSnapshot(readFileSync(file, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
    process.exit(1);
  }
  return { snapshot, board, radar };
}

/** Write the ranked board and the dashboard's standalone script payload. */
export function writeScoredFiles(out: string, board: BoardRow[], radar: RadarData): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataScript(radar));
}

/** Copy a folder's regular files into `to`, ignoring dot-files and subdirectories. */
export function mirrorRegularFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** Mirror both static folders and enforce the screenshot count and naming rules. */
export function stageStaticAssets(out: string): string[] {
  mirrorRegularFiles(join(entryDir, 'dashboard'), join(out, 'dashboard'));
  const shots = mirrorRegularFiles(join(entryDir, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
    process.exit(1);
  }
  for (const name of shots) {
    if (!VALID_IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
  }
  return shots;
}

/** Build the dossier from the completed output directory, under the gate's caps. */
export function writeDossier(out: string): void {
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, {
    text_max_bytes: TEXT_CAP_BYTES,
    screenshots: IMAGE_CAPS,
    dashboard: DASHBOARD_CAPS,
  }));
}
