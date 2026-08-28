#!/usr/bin/env node
/**
 * Generate the CODE14 wall pieces as pixel art.
 *
 * Hand-drawn PNGs would be a dead end: nudging one brand colour would mean
 * redrawing every sprite by hand, and the palette below is lifted straight off
 * code14.nl, where it can change. So the sprites are described here and the
 * files are output -- edit a colour or a glyph, re-run, done.
 *
 *   node scripts/generate-brand-assets.mjs
 *
 * Writes into webview-ui/public/assets/furniture/, which esbuild copies to
 * dist/assets/ and the server then serves to every office viewer.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FURNITURE = join(ROOT, 'webview-ui', 'public', 'assets', 'furniture');

/** Sampled from code14.nl's own computed styles, not eyeballed off a
 *  screenshot: the dark is the site header, the coral is its accent, the mints
 *  are its section backgrounds. */
const C = {
  dark: [0x25, 0x36, 0x37, 255],
  darker: [0x1c, 0x29, 0x2a, 255],
  coral: [0xf8, 0x83, 0x5b, 255],
  mint: [0x96, 0xb9, 0xb6, 255],
  paleMint: [0xd2, 0xe7, 0xe2, 255],
  paper: [0xf2, 0xf2, 0xf0, 255],
  none: [0, 0, 0, 0],
};

/** 5x7 glyphs -- only the characters the wordmark needs. */
const FONT = {
  C: [' ### ', '#   #', '#    ', '#    ', '#    ', '#   #', ' ### '],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  D: ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  1: ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  4: ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '],
};

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4); // transparent by default
  }

  set(x, y, rgba) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    this.px[o] = rgba[0];
    this.px[o + 1] = rgba[1];
    this.px[o + 2] = rgba[2];
    this.px[o + 3] = rgba[3];
  }

  rect(x, y, w, h, rgba) {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, rgba);
  }

  /** Outlined box with the corner pixels dropped, which is what reads as
   *  "rounded" at this size -- an actual radius just looks like a mistake. */
  panel(x, y, w, h, border, fill) {
    this.rect(x, y, w, h, border);
    this.rect(x + 2, y + 2, w - 4, h - 4, fill);
    for (const [cx, cy] of [
      [x, y],
      [x + w - 1, y],
      [x, y + h - 1],
      [x + w - 1, y + h - 1],
    ]) {
      this.set(cx, cy, C.none);
    }
  }

  text(str, x, y, rgba, scale = 1) {
    let cx = x;
    for (const ch of str) {
      const glyph = FONT[ch];
      if (!glyph) {
        cx += (5 + 1) * scale;
        continue;
      }
      glyph.forEach((row, gy) => {
        [...row].forEach((cell, gx) => {
          if (cell !== '#') return;
          this.rect(cx + gx * scale, y + gy * scale, scale, scale, rgba);
        });
      });
      cx += (5 + 1) * scale;
    }
    return cx - x - scale; // width drawn, minus the trailing gap
  }

  static textWidth(str, scale = 1) {
    return str.length * 6 * scale - scale;
  }

  toPng() {
    const chunk = (type, data) => {
      const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body) >>> 0);
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    const raw = Buffer.alloc(this.h * (this.w * 4 + 1));
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0; // no filter
      Buffer.from(this.px.buffer, y * this.w * 4, this.w * 4).copy(raw, y * (this.w * 4 + 1) + 1);
    }
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function emit(id, name, canvas, footprintW, footprintH) {
  const dir = join(FURNITURE, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.png`), canvas.toPng());
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        id,
        name,
        category: 'wall',
        type: 'asset',
        canPlaceOnWalls: true,
        canPlaceOnSurfaces: false,
        backgroundTiles: 0,
        width: canvas.w,
        height: canvas.h,
        footprintW,
        footprintH,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`  ✓ ${id}  ${canvas.w}x${canvas.h}`);
}

// ── CODE14 sign: the wordmark, 3 tiles wide ──────────────────
{
  const c = new Canvas(48, 32);
  c.panel(1, 5, 46, 22, C.dark, C.paper);
  // The coral tick above the wordmark, echoing the site's accent dot.
  c.rect(20, 8, 8, 2, C.coral);
  const word = 'CODE14';
  c.text(word, Math.round((48 - Canvas.textWidth(word)) / 2), 12, C.darker);
  // A mint footing so the piece carries more than one brand colour.
  c.rect(3, 24, 42, 1, C.paleMint);
  emit('CODE14_SIGN', 'CODE14 Sign', c, 3, 2);
}

// ── CODE14 logo: the short mark, 2 tiles ─────────────────────
{
  const c = new Canvas(32, 32);
  c.panel(1, 5, 30, 22, C.dark, C.paper);
  c.rect(12, 8, 8, 2, C.coral);
  const mark = '14';
  c.text(mark, Math.round((32 - Canvas.textWidth(mark, 2)) / 2), 12, C.darker, 2);
  emit('CODE14_LOGO', 'CODE14 Logo', c, 2, 2);
}

// ── A mint accent panel, for walls that need brand and not words ──
{
  const c = new Canvas(16, 32);
  c.panel(1, 5, 14, 22, C.dark, C.mint);
  c.rect(5, 11, 6, 2, C.coral);
  c.rect(5, 15, 6, 1, C.paper);
  c.rect(5, 18, 6, 1, C.paper);
  emit('CODE14_PANEL', 'CODE14 Panel', c, 1, 2);
}

console.log('CODE14 assets written to webview-ui/public/assets/furniture/');
