import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, Buffer.from(payload)]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

export class Surface {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, background: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    this.fillRect(0, 0, width, height, background);
  }

  setPixel(x: number, y: number, color: number): void {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const i = (py * this.width + px) * 4;
    this.data[i] = (color >>> 16) & 0xff;
    this.data[i + 1] = (color >>> 8) & 0xff;
    this.data[i + 2] = color & 0xff;
    this.data[i + 3] = 0xff;
  }

  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.floor(x + w));
    const y1 = Math.min(this.height, Math.floor(y + h));
    if (x1 <= x0 || y1 <= y0) return;
    const r = (color >>> 16) & 0xff;
    const g = (color >>> 8) & 0xff;
    const b = color & 0xff;
    for (let py = y0; py < y1; py++) {
      let i = (py * this.width + x0) * 4;
      for (let px = x0; px < x1; px++) {
        this.data[i] = r;
        this.data[i + 1] = g;
        this.data[i + 2] = b;
        this.data[i + 3] = 0xff;
        i += 4;
      }
    }
  }

  circle(cx: number, cy: number, radius: number, color: number): void {
    const r2 = radius * radius;
    const x0 = Math.floor(cx - radius);
    const x1 = Math.ceil(cx + radius);
    const y0 = Math.floor(cy - radius);
    const y1 = Math.ceil(cy + radius);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.setPixel(x, y, color);
      }
    }
  }

  ring(cx: number, cy: number, radius: number, thickness: number, color: number): void {
    const outer = radius * radius;
    const inner = Math.max(0, radius - thickness);
    const inner2 = inner * inner;
    const x0 = Math.floor(cx - radius);
    const x1 = Math.ceil(cx + radius);
    const y0 = Math.floor(cy - radius);
    const y1 = Math.ceil(cy + radius);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= outer && d2 >= inner2) this.setPixel(x, y, color);
      }
    }
  }

  roundRect(x: number, y: number, w: number, h: number, radius: number, color: number): void {
    const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
    if (r === 0) {
      this.fillRect(x, y, w, h, color);
      return;
    }
    this.fillRect(x + r, y, w - r * 2, h, color);
    this.fillRect(x, y + r, w, h - r * 2, color);
    this.circle(x + r, y + r, r, color);
    this.circle(x + w - r, y + r, r, color);
    this.circle(x + r, y + h - r, r, color);
    this.circle(x + w - r, y + h - r, r, color);
  }

  line(x0: number, y0: number, x1: number, y1: number, color: number, thickness = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(length * 2));
    const radius = Math.max(0.5, thickness / 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.circle(x0 + dx * t, y0 + dy * t, radius, color);
    }
  }

  polyline(points: Array<[number, number]>, color: number, thickness = 1): void {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      this.line(a[0], a[1], b[0], b[1], color, thickness);
    }
  }

  save(path: string): void {
    const png = encodePNG(this);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, png);
  }
}

export function encodePNG(surface: Surface): Buffer {
  const { width, height, data } = surface;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }

  const compressed = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
