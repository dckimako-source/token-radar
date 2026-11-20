import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Surface } from './src/draw.ts';
import {
  bindPixels,
  drawText,
  measureText,
  wrapText,
  FONT_HEIGHT,
  FONT_LINE_GAP,
} from './src/font.ts';

const W = 1024;
const H = 1024;
const BG = 0x0d1b2a;
const CARD_BG = 0x12243a;
const WHITE = 0xeaf3fb;
const MUTED = 0xa9bfd0;
const DIM = 0x7e95a8;
const RULE = 0x1e3a52;

const MARGIN = 32;
const GRID_TOP = 150;
const GRID_COLS = 2;
const GRID_ROWS = 4;
const COL_GAP = 16;
const ROW_GAP = 12;
const CARD_W = Math.floor((W - MARGIN * 2 - COL_GAP) / 2);
const CARD_H = 192;
const CARD_RADIUS = 12;
const BORDER_W = 8;
const PAD = 16;
const ICON_SIZE = 84;
const TEXT_GAP = 16;

type Story = {
  region: string;
  headline: string;
  sub: string;
  accent: number;
  icon: number;
};

const STORIES: Story[] = [
  {
    region: 'EUROPE',
    headline: 'UK and EU agree reset deal',
    sub: 'youth mobility scheme at crunch summit',
    accent: 0x4aa3ff,
    icon: 0,
  },
  {
    region: 'UKRAINE',
    headline: 'Russia storms Kyiv: 3 bridges hit',
    sub: 'Europe says ready to talk peace',
    accent: 0xffd166,
    icon: 1,
  },
  {
    region: 'MARKETS',
    headline: 'AI sell-off: stocks slump worldwide',
    sub: 'Anthropic IPO fails to calm fears',
    accent: 0xff6b6b,
    icon: 2,
  },
  {
    region: 'ASIA',
    headline: 'Pakistan minister visits India',
    sub: 'first visit since 2025 war',
    accent: 0xf4a261,
    icon: 3,
  },
  {
    region: 'HEALTH',
    headline: 'Pancreatic cancer pill breakthrough',
    sub: 'hailed as best in decades',
    accent: 0x2ec4b6,
    icon: 4,
  },
  {
    region: 'LATIN AMERICA',
    headline: 'Bukele seeks third term',
    sub: 'El Salvador constitution changed',
    accent: 0xb388ff,
    icon: 5,
  },
  {
    region: 'BRAZIL',
    headline: 'Lula visits Chief Raoni',
    sub: 'Brazil recognises Indigenous land',
    accent: 0x5ddc7a,
    icon: 6,
  },
  {
    region: 'USA/TECH',
    headline: 'California probes Nvidia',
    sub: 'over chip exports to China',
    accent: 0xff9f1c,
    icon: 7,
  },
];

const surface = new Surface(W, H, BG);
bindPixels((x, y, color) => surface.setPixel(x, y, color));

const failures: string[] = [];
let checkCount = 0;

function check(name: string, ok: boolean, detail: string): void {
  checkCount++;
  if (!ok) failures.push(name);
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}: ${detail}`);
}

function drawIconBox(x: number, y: number, accent: number, icon: number): void {
  surface.roundRect(x, y, ICON_SIZE, ICON_SIZE, 16, 0x0e1f31);
  surface.ring(x + ICON_SIZE / 2, y + ICON_SIZE / 2, 40, 1, 0x1d3548);

  const cx = x + ICON_SIZE / 2;
  const cy = y + ICON_SIZE / 2;

  if (icon === 0) {
    surface.ring(cx - 10, cy, 17, 5, accent);
    surface.ring(cx + 10, cy, 17, 5, 0xdbe9f4);
  } else if (icon === 1) {
    surface.line(x + 12, y + 55, x + 72, y + 55, 0xdbe9f4, 3);
    surface.line(x + 26, y + 34, x + 26, y + 59, accent, 3);
    surface.line(x + 58, y + 34, x + 58, y + 59, accent, 3);
    surface.line(x + 26, y + 35, x + 14, y + 54, 0xdbe9f4, 1.5);
    surface.line(x + 26, y + 35, x + 38, y + 54, 0xdbe9f4, 1.5);
    surface.line(x + 58, y + 35, x + 46, y + 54, 0xdbe9f4, 1.5);
    surface.line(x + 58, y + 35, x + 70, y + 54, 0xdbe9f4, 1.5);
    surface.circle(x + 64, y + 24, 8, 0xff5c5c);
    surface.line(x + 64, y + 13, x + 64, y + 18, 0xff8a8a, 2);
  } else if (icon === 2) {
    surface.line(x + 16, y + 64, x + 70, y + 64, MUTED, 2);
    surface.line(x + 16, y + 20, x + 16, y + 64, MUTED, 2);
    surface.polyline(
      [
        [x + 21, y + 29],
        [x + 33, y + 46],
        [x + 43, y + 37],
        [x + 55, y + 54],
        [x + 68, y + 63],
      ],
      accent,
      3,
    );
    surface.line(x + 68, y + 63, x + 59, y + 60, accent, 2);
    surface.line(x + 68, y + 63, x + 66, y + 54, accent, 2);
  } else if (icon === 3) {
    surface.circle(x + 26, y + 36, 9, accent);
    surface.circle(x + 26, y + 36, 4, 0x0e1f31);
    surface.line(x + 26, y + 45, x + 26, y + 60, accent, 3);
    surface.circle(x + 58, y + 51, 9, 0xdbe9f4);
    surface.circle(x + 58, y + 51, 4, 0x0e1f31);
    surface.line(x + 58, y + 60, x + 58, y + 70, 0xdbe9f4, 3);
    surface.line(x + 35, y + 39, x + 42, y + 44, 0xdbe9f4, 2);
    surface.line(x + 46, y + 47, x + 52, y + 50, 0xdbe9f4, 2);
  } else if (icon === 4) {
    surface.roundRect(x + 18, y + 35, 48, 20, 10, 0xeaf4ff);
    surface.roundRect(x + 18, y + 35, 24, 20, 10, accent);
    surface.fillRect(x + 30, y + 35, 12, 20, accent);
    surface.fillRect(x + 42, y + 35, 1, 20, 0x0e1f31);
    surface.line(x + 64, y + 19, x + 64, y + 31, accent, 2);
    surface.line(x + 58, y + 25, x + 70, y + 25, accent, 2);
  } else if (icon === 5) {
    surface.roundRect(x + 31, y + 17, 23, 25, 3, 0xeaf4ff);
    surface.line(x + 36, y + 31, x + 41, y + 36, accent, 2);
    surface.line(x + 41, y + 36, x + 49, y + 26, accent, 2);
    surface.roundRect(x + 20, y + 44, 44, 27, 5, accent);
    surface.fillRect(x + 30, y + 47, 24, 4, 0x0e1f31);
    surface.fillRect(x + 38, y + 60, 8, 6, 0x0e1f31);
  } else if (icon === 6) {
    surface.circle(x + 42, y + 31, 16, accent);
    surface.circle(x + 30, y + 37, 12, accent);
    surface.circle(x + 54, y + 37, 12, accent);
    surface.line(x + 42, y + 42, x + 42, y + 65, 0xc9a27d, 5);
    surface.line(x + 22, y + 67, x + 62, y + 67, 0x7f9b6e, 2);
    surface.line(x + 42, y + 48, x + 34, y + 55, accent, 2);
    surface.line(x + 42, y + 52, x + 50, y + 58, accent, 2);
  } else {
    surface.roundRect(x + 24, y + 24, 36, 36, 6, accent);
    surface.roundRect(x + 31, y + 31, 22, 22, 3, 0x0e1f31);
    surface.roundRect(x + 38, y + 38, 8, 8, 2, accent);
    for (const px of [x + 31, x + 42, x + 53]) {
      surface.line(px, y + 13, px, y + 24, 0xdbe9f4, 2);
      surface.line(px, y + 60, px, y + 71, 0xdbe9f4, 2);
    }
    for (const py of [y + 31, y + 42, y + 53]) {
      surface.line(x + 13, py, x + 24, py, 0xdbe9f4, 2);
      surface.line(x + 60, py, x + 71, py, 0xdbe9f4, 2);
    }
  }
}

type CardCheck = {
  index: number;
  region: string;
  cardX: number;
  cardY: number;
  cardW: number;
  cardH: number;
  textX: number;
  textMaxW: number;
  textTop: number;
  textBottom: number;
  iconX: number;
  iconY: number;
  iconW: number;
  iconH: number;
  headLines: string[];
  subLines: string[];
};

function drawCard(x: number, y: number, story: Story, index: number): CardCheck {
  surface.roundRect(x, y, CARD_W, CARD_H, CARD_RADIUS, CARD_BG);
  surface.fillRect(x, y + CARD_RADIUS, BORDER_W, CARD_H - CARD_RADIUS * 2, story.accent);
  surface.circle(x + BORDER_W / 2, y + CARD_RADIUS, BORDER_W / 2, story.accent);
  surface.circle(x + BORDER_W / 2, y + CARD_H - CARD_RADIUS, BORDER_W / 2, story.accent);

  const iconX = x + CARD_W - PAD - ICON_SIZE;
  const iconY = y + Math.round((CARD_H - ICON_SIZE) / 2);
  drawIconBox(iconX, iconY, story.accent, story.icon);

  const textX = x + BORDER_W + PAD;
  const textMaxW = iconX - TEXT_GAP - textX;
  let headLines = wrapText(story.headline, textMaxW, 3);
  if (story.region === 'MARKETS') {
    const preferred = ['AI sell-off: stocks', 'slump worldwide'];
    if (preferred.every((line) => measureText(line, 3) <= textMaxW)) {
      headLines = preferred;
    }
  }
  const subLines = wrapText(story.sub, textMaxW, 2);

  const tagH = FONT_HEIGHT * 2;
  const headLineH = FONT_HEIGHT * 3;
  const headAdvance = headLineH + FONT_LINE_GAP * 3;
  const subLineH = FONT_HEIGHT * 2;
  const subAdvance = subLineH + FONT_LINE_GAP * 2;
  const headBlockH = (headLines.length - 1) * headAdvance + headLineH;
  const subBlockH = (subLines.length - 1) * subAdvance + subLineH;
  const blockH = tagH + 8 + headBlockH + 12 + subBlockH;
  const blockTop = y + Math.round((CARD_H - blockH) / 2);
  const tagY = blockTop;
  const headY = tagY + tagH + 8;
  const subY = headY + headBlockH + 12;
  const blockBottom = subY + subBlockH;

  drawText(textX, tagY, story.region, 2, story.accent);
  for (let i = 0; i < headLines.length; i++) {
    drawText(textX, headY + i * headAdvance, headLines[i], 3, 0xf2f6fa);
  }
  for (let i = 0; i < subLines.length; i++) {
    drawText(textX, subY + i * subAdvance, subLines[i], 2, 0xc9d6e2);
  }

  return {
    index,
    region: story.region,
    cardX: x,
    cardY: y,
    cardW: CARD_W,
    cardH: CARD_H,
    textX,
    textMaxW,
    textTop: blockTop,
    textBottom: blockBottom,
    iconX,
    iconY,
    iconW: ICON_SIZE,
    iconH: ICON_SIZE,
    headLines,
    subLines,
  };
}

const title = '20 NOVEMBER 2026';
const titleScale = 8;
const titleWidth = measureText(title, titleScale);
const titleTop = 22;
drawText((W - titleWidth) / 2, titleTop, title, titleScale, WHITE);

const subtitle = "THE WORLD'S NEWS, IN ONE IMAGE";
const subtitleScale = 3;
const subtitleWidth = measureText(subtitle, subtitleScale);
const subtitleTop = titleTop + FONT_HEIGHT * titleScale + 26;
drawText((W - subtitleWidth) / 2, subtitleTop, subtitle, subtitleScale, 0x8fb3cf);

surface.fillRect(MARGIN, 138, W - MARGIN * 2, 2, RULE);

const cards: CardCheck[] = [];
let storyIndex = 0;
for (let row = 0; row < GRID_ROWS; row++) {
  for (let col = 0; col < GRID_COLS; col++) {
    const x = MARGIN + col * (CARD_W + COL_GAP);
    const y = GRID_TOP + row * (CARD_H + ROW_GAP);
    cards.push(drawCard(x, y, STORIES[storyIndex], storyIndex));
    storyIndex++;
  }
}

const footer = 'Friday 20 November 2026 - sources: BBC, Guardian, Al Jazeera feeds';
const footerScale = 2;
const footerWidth = measureText(footer, footerScale);
const footerTop = 978;
drawText((W - footerWidth) / 2, footerTop, footer, footerScale, 0xb9c6d4);

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const outPath = join(outDir, 'entry.png');
surface.save(outPath);

console.log(`Wrote ${outPath}`);
console.log('Layout verification:');

check('title top margin', titleTop >= 20, `${titleTop}px (>= 20)`);
check(
  'title/subtitle gap',
  subtitleTop - (titleTop + FONT_HEIGHT * titleScale) >= 24,
  `${subtitleTop - (titleTop + FONT_HEIGHT * titleScale)}px (>= 24)`,
);

for (const card of cards) {
  const cardBottom = card.cardY + card.cardH;
  const cardRight = card.cardX + card.cardW;
  const label = `card ${card.index + 1} ${card.region}`;
  check(
    `${label} text inside card`,
    card.textTop >= card.cardY && card.textBottom <= cardBottom,
    `text ${card.textTop}..${card.textBottom}, card ${card.cardY}..${cardBottom}`,
  );
  check(
    `${label} text column`,
    card.textMaxW >= 300,
    `${card.textMaxW}px (>= 300)`,
  );
  check(
    `${label} pictogram clear`,
    card.textX + card.textMaxW <= card.iconX &&
      card.iconX >= card.cardX &&
      card.iconX + card.iconW <= cardRight &&
      card.iconY >= card.cardY &&
      card.iconY + card.iconH <= cardBottom &&
      card.iconW <= 84 &&
      card.iconH <= 84,
    `${card.iconW}x${card.iconH} at x=${card.iconX}, text ends at ${card.textX + card.textMaxW}`,
  );
  check(
    `${label} wrap endings`,
    card.headLines[card.headLines.length - 1].split(' ').length > 1 &&
      card.subLines[card.subLines.length - 1].split(' ').length > 1,
    `"${card.headLines[card.headLines.length - 1]}" / "${card.subLines[card.subLines.length - 1]}"`,
  );
}

const png = readFileSync(outPath);
const size = statSync(outPath).size;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const signatureOk = png.length >= 24 && png.subarray(0, 8).equals(signature);
const pngWidth = signatureOk ? png.readUInt32BE(16) : 0;
const pngHeight = signatureOk ? png.readUInt32BE(20) : 0;

console.log('PNG verification:');
check('signature', signatureOk, signatureOk ? 'valid PNG 8-byte signature' : 'bad signature');
check('dimensions', pngWidth === W && pngHeight === H, `${pngWidth}x${pngHeight} (expected ${W}x${H})`);
check('file size under 1 MiB', size > 0 && size < 1024 * 1024, `${size} bytes (${(size / 1048576).toFixed(2)} MiB)`);
check('all text blocks inside cards', cards.every((c) => c.textBottom <= c.cardY + c.cardH), `${cards.length}/${cards.length} within bounds`);

console.log(`File size: ${size} bytes`);
console.log(`Verification: ${failures.length === 0 ? 'PASS' : 'FAIL'} (${checkCount - failures.length}/${checkCount} checks)`);
if (failures.length > 0) {
  console.log(`Failed checks: ${failures.join(', ')}`);
  process.exitCode = 1;
}
