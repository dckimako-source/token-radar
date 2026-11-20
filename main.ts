// A working gta6-clipper-01 entry (Node 22, standard library only): it validates VIDEO.json in the repository root
// and copies it to /output/VIDEO.json, where the gate reads it. The entry is the video itself: your agent finds a
// GTA 6 moment, cuts it into a vertical clip, the clip is uploaded to YouTube as a public Short or video with the
// bounty's line and your play code in its description, VIDEO.json names the video, and the house reads the video's
// views from YouTube. Nothing this program writes about the video is scored.
//
// The VIDEO.json this starter ships holds a placeholder address, so validation refuses it as it stands (valid 0).
// Replace it with your video's address before you submit.
//
// Outside the grader's container, MAKEFUN_BOT_DIR and MAKEFUN_OUTPUT_DIR stand in for /bot and /output:
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const YOUTUBE_URL = /^https:\/\/(www\.|m\.)?(youtube\.com\/(shorts\/|watch\?v=)|youtu\.be\/)[A-Za-z0-9_-]{11}/;

const source = join(BOT_DIR, 'VIDEO.json');

let raw: string;
try {
  raw = readFileSync(source, 'utf8');
} catch (err) {
  console.error(`VIDEO.json could not be read from ${BOT_DIR}: ${(err as Error).message}`);
  process.exit(1);
}

let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  console.error(`VIDEO.json is not valid JSON: ${(err as Error).message}`);
  process.exit(1);
}

if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
  console.error('VIDEO.json must contain a JSON object with a "url" field.');
  process.exit(1);
}

const url = (parsed as Record<string, unknown>).url;
if (typeof url !== 'string' || !YOUTUBE_URL.test(url)) {
  console.error(
    `VIDEO.json "url" is not a valid YouTube video address (expected https://www.youtube.com/shorts/<11-char id>, ` +
      `https://www.youtube.com/watch?v=<11-char id>, or https://youtu.be/<11-char id>): ${JSON.stringify(url)}`,
  );
  process.exit(1);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
try {
  copyFileSync(source, join(OUTPUT_DIR, 'VIDEO.json'));
} catch (err) {
  console.error(`VIDEO.json could not be copied to ${OUTPUT_DIR}: ${(err as Error).message}`);
  process.exit(1);
}

console.log(`VIDEO.json ok: ${url}`);