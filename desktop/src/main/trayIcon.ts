/**
 * Generates the tray icon at runtime (a filled brand-blue disc with a lighter ring) so the repo needs
 * no binary asset and the colour comes from the design tokens. Pure; unit-tested for PNG validity.
 */
import { crc32, deflateSync } from 'node:zlib';
import { blue } from '../renderer/src/design/tokens/primitives';

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function makeTrayPng(size = 32): Buffer {
  const fill = hexToRgb(blue[600]);
  const ring = hexToRgb(blue[200]);
  const c = (size - 1) / 2;
  const rOuter = size / 2 - 1;
  const rInner = rOuter - Math.max(2, size / 8);
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const o = 1 + x * 4;
      if (d <= rOuter) {
        const [r, g, b] = d > rInner ? ring : fill;
        row[o] = r;
        row[o + 1] = g;
        row[o + 2] = b;
        row[o + 3] = 255;
      }
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
