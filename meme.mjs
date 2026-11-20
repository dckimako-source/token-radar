import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync } from 'node:fs';

const W = 1024, H = 1024;
const buf = Buffer.alloc(W * H * 4);

function px(x, y, c) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const a = c.length > 3 ? c[3] : 255;
  if (a >= 255) {
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
  } else {
    const t = a / 255, u = 1 - t;
    buf[i] = Math.round(c[0] * t + buf[i] * u);
    buf[i + 1] = Math.round(c[1] * t + buf[i + 1] * u);
    buf[i + 2] = Math.round(c[2] * t + buf[i + 2] * u);
    buf[i + 3] = 255;
  }
}

function fillRect(x, y, w, h, c) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w)), y1 = Math.min(H, Math.round(y + h));
  for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) px(i, j, c);
}

function fillCircle(cx, cy, r, c) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy <= r2) px(x, y, c);
  }
}

function roundRect(x, y, w, h, r, c) {
  r = Math.min(r, w / 2, h / 2);
  fillRect(x + r, y, w - 2 * r, h, c);
  fillRect(x, y + r, w, h - 2 * r, c);
  fillCircle(x + r, y + r, r, c);
  fillCircle(x + w - r, y + r, r, c);
  fillCircle(x + r, y + h - r, r, c);
  fillCircle(x + w - r, y + h - r, r, c);
}

function fillSparkle(cx, cy, r, c) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const u = Math.abs(x - cx) / r, v = Math.abs(y - cy) / r;
    if (Math.pow(u, 0.55) + Math.pow(v, 0.55) <= 1) px(x, y, c);
  }
}

function fillPoly(pts, c) {
  let ymin = Infinity, ymax = -Infinity;
  for (const p of pts) { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }
  for (let y = Math.max(0, Math.floor(ymin)); y <= Math.min(H - 1, Math.ceil(ymax)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) px(x, y, c);
    }
  }
}

function starPts(cx, cy, ro, ri, n = 5) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + i * Math.PI / n;
    const r = i % 2 === 0 ? ro : ri;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function boldExtra(s) { return Math.max(1, Math.floor(s * 0.25)); }
function textWidth(t, s) { return t.length * 6 * s - s + boldExtra(s); }

function drawText(t, x, y, s, c) {
  const b = boldExtra(s);
  for (const ch of t) {
    const g = FONT[ch] || FONT[' '];
    for (let r = 0; r < 7; r++) for (let col = 0; col < 5; col++) {
      if (g[r][col] === '1') fillRect(x + col * s, y + r * s, s + b, s + b, c);
    }
    x += 6 * s;
  }
}

function drawCentered(t, y, s, c) {
  drawText(t, Math.round((W - textWidth(t, s)) / 2), y, s, c);
}

function drawCenteredShadow(t, y, s, c, sh, off) {
  const x = Math.round((W - textWidth(t, s)) / 2);
  drawText(t, x + off, y + off, s, sh);
  drawText(t, x, y, s, c);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function downsample(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const rx = sw / dw, ry = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy0 = y * ry, fy1 = fy0 + ry;
    for (let x = 0; x < dw; x++) {
      const fx0 = x * rx, fx1 = fx0 + rx;
      let r = 0, g = 0, b = 0, a = 0, tot = 0;
      for (let sy = Math.floor(fy0); sy < Math.ceil(fy1); sy++) {
        const wy = Math.min(fy1, sy + 1) - Math.max(fy0, sy);
        for (let sx = Math.floor(fx0); sx < Math.ceil(fx1); sx++) {
          const wgt = wy * (Math.min(fx1, sx + 1) - Math.max(fx0, sx));
          const i = (sy * sw + sx) * 4;
          r += src[i] * wgt; g += src[i + 1] * wgt; b += src[i + 2] * wgt; a += src[i + 3] * wgt;
          tot += wgt;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = Math.round(r / tot); out[o + 1] = Math.round(g / tot);
      out[o + 2] = Math.round(b / tot); out[o + 3] = Math.round(a / tot);
    }
  }
  return out;
}

let seed = 20261120;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

const BLACK = [10, 5, 15];
const WHITE = [255, 255, 255];
const MAGENTA = [255, 46, 151];
const PINK = [255, 79, 163];
const SHADOW = [24, 6, 40];

function lerp(a, b, t) { return a + (b - a) * t; }

function sky() {
  const stops = [[0, 43, 17, 96], [0.5, 216, 48, 140], [1, 255, 158, 64]];
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    let s0 = stops[0], s1 = stops[1];
    if (t > 0.5) { s0 = stops[1]; s1 = stops[2]; }
    const u = (t - s0[0]) / (s1[0] - s0[0]);
    const r = Math.round(lerp(s0[1], s1[1], u));
    const g = Math.round(lerp(s0[2], s1[2], u));
    const b = Math.round(lerp(s0[3], s1[3], u));
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
  }
  for (let i = 0; i < 110; i++) {
    const x = Math.floor(rnd() * W), y = Math.floor(rnd() * 400);
    const a = 90 + Math.floor(rnd() * 165);
    const s = rnd() > 0.85 ? 2 : 1;
    fillRect(x, y, s, s, [255, 255, 255, a]);
  }
}

function palm(bx, by, tx, ty) {
  const cx = bx + (tx - bx) * 0.15, cy = by - (by - ty) * 0.55;
  for (let i = 0; i <= 48; i++) {
    const t = i / 48, u = 1 - t;
    const x = u * u * bx + 2 * u * t * cx + t * t * tx;
    const y = u * u * by + 2 * u * t * cy + t * t * ty;
    fillCircle(x, y, 15 - 7 * t, BLACK);
  }
  for (let f = 0; f < 8; f++) {
    const a = (-175 + f * (170 / 7)) * Math.PI / 180;
    const L = 118 + (f % 3) * 20;
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const x = tx + Math.cos(a) * L * t;
      const y = ty + Math.sin(a) * L * t + 0.55 * L * t * t;
      fillCircle(x, y, 9 * (1 - t) + 2, BLACK);
    }
  }
  fillCircle(tx - 8, ty + 10, 6, BLACK);
  fillCircle(tx + 7, ty + 12, 6, BLACK);
  fillCircle(tx, ty + 18, 6, BLACK);
}

function skyline() {
  fillRect(0, 856, W, 20, [255, 176, 88, 130]);
  let x = -20;
  while (x < W + 20) {
    const w = 52 + Math.floor(rnd() * 92);
    const h = 55 + Math.floor(rnd() * 95);
    const top = H - h;
    fillRect(x, top, w, h, BLACK);
    if (rnd() > 0.65) fillRect(x + w / 2 - 2, top - 26, 4, 26, BLACK);
    x += w + 4 + Math.floor(rnd() * 12);
  }
  fillRect(0, 1000, W, 24, BLACK);
  palm(24, 1024, 108, 520);
  palm(1004, 1024, 958, 548);
}

function loadingBar() {
  roundRect(100, 688, 824, 80, 28, BLACK);
  roundRect(112, 700, 800, 56, 18, [26, 10, 46]);
  const fillW = Math.round(800 * 0.99);
  roundRect(112, 700, fillW, 56, 18, MAGENTA);
  roundRect(868, 700, 36, 56, 18, [255, 143, 208]);
  roundRect(894, 700, 10, 56, 5, [255, 224, 243]);
  fillRect(124, 706, 756, 6, [255, 255, 255, 64]);
  fillCircle(904, 728, 44, [255, 120, 200, 56]);
}

function ghost() {
  const cx = 880;
  fillCircle(cx, 596, 60, BLACK);
  fillRect(cx - 60, 596, 120, 82, BLACK);
  for (const dx of [-36, 0, 36]) fillCircle(cx + dx, 678, 24, BLACK);
  fillCircle(cx, 596, 54, WHITE);
  fillRect(cx - 54, 596, 108, 82, WHITE);
  for (const dx of [-36, 0, 36]) fillCircle(cx + dx, 678, 18, WHITE);
  fillSparkle(cx - 22, 592, 13, BLACK);
  fillSparkle(cx + 22, 592, 13, BLACK);
  fillCircle(942, 648, 17, BLACK);
  fillCircle(942, 648, 13, WHITE);
  fillCircle(960, 628, 24, BLACK);
  fillCircle(960, 628, 20, MAGENTA);
  fillPoly(starPts(960, 628, 10, 4.4), WHITE);
}

sky();
fillCircle(512, 380, 310, [255, 80, 170, 42]);
fillCircle(512, 380, 210, [255, 120, 190, 36]);
drawCenteredShadow('VI', 228, 42, PINK, [64, 12, 70], 10);
skyline();
drawCenteredShadow('LOADING LEONIDA...', 76, 8, WHITE, SHADOW, 5);
drawCenteredShadow('99%', 560, 17, WHITE, SHADOW, 6);
loadingBar();
drawCenteredShadow('EST. TIME REMAINING: 13 YEARS', 788, 5, [255, 64, 178], SHADOW, 3);
ghost();

const meme = encodePNG(W, H, buf);
writeFileSync('meme.png', meme);
const preview = encodePNG(480, 480, downsample(buf, W, H, 480, 480));
writeFileSync('preview.png', preview);

function verify(file, w, h) {
  const b = readFileSync(file);
  const sigOk = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const iw = b.readUInt32BE(16), ih = b.readUInt32BE(20);
  if (!sigOk || iw !== w || ih !== h) throw new Error(`${file}: bad PNG (sig=${sigOk} ${iw}x${ih})`);
  console.log(`${file}: ${b.length} bytes, ${iw}x${ih}, signature OK`);
}
verify('meme.png', 1024, 1024);
verify('preview.png', 480, 480);
