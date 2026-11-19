// The token radar's command-line glue: argument parsing, the success report and orchestration.
//
// One invocation scores the sealed snapshot, validates the ranked board, writes the board and the
// dashboard's data payload, mirrors the static assets, and finally writes the dossier. The dossier is
// deliberately last: the scorer rebuilds it from the finished output directory and compares bytes.
//
// Every stage either returns its result or ends the process with the same diagnostic and exit code the
// original entry used, so `node main.ts --input ... --output ...` behaves exactly as before.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BoardRow, RadarData, Snapshot } from './lib/model.ts';
import { scoreSnapshot, stageStaticAssets, writeDossier, writeScoredFiles } from './lib-main.ts';

/** Read `--name value` or `--name=value` from argv, falling back when the flag is absent. */
function optionValue(name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return inline === undefined ? fallback : inline.slice(flag.length + 1);
}

/** Resolve `--input` to a snapshot file: a .json path stands alone, anything else is a folder. */
function findSnapshotFile(): string {
  const requested = optionValue('input', '/input');
  const file = requested.endsWith('.json') ? requested : join(requested, 'snapshot.json');
  if (!existsSync(file)) {
    process.stderr.write(`token radar: no snapshot at ${file}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
    process.exit(2);
  }
  return file;
}

/** Resolve `--output`, using MAKEFUN_OUTPUT_DIR as the stand-in for /output outside the grader. */
function findOutputDir(): string {
  return optionValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
}

/** The two-line success report names every artifact the run produced. */
function announce(out: string, snapshot: Snapshot, board: BoardRow[], radar: RadarData, shots: string[]): void {
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
  );
}

/** Run the full scoring pass described by argv. */
export function main(): void {
  const file = findSnapshotFile();
  const out = findOutputDir();
  const { snapshot, board, radar } = scoreSnapshot(file);
  writeScoredFiles(out, board, radar);
  const shots = stageStaticAssets(out);
  writeDossier(out);
  announce(out, snapshot, board, radar, shots);
}
