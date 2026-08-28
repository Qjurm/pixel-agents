#!/usr/bin/env node
/**
 * Generate the CODE14 office pieces as pixel art.
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
  /* The props below depict food and sports gear, which the brand palette has
   * no honest colour for -- a mint meatball reads as a mistake, not as style.
   * These few are kept deliberately desaturated so they sit next to the brand
   * colours instead of competing with them. */
  meat: [0x7a, 0x4c, 0x33, 255],
  meatLit: [0x9c, 0x66, 0x45, 255],
  crust: [0xc2, 0x92, 0x5c, 255],
  crumb: [0xe6, 0xcb, 0x9c, 255],
  /* Modern desk hardware is anodised aluminium and dark plastic, which the
   * brand palette also has no honest colour for. These four are neutral on
   * purpose: tinting them teal would make every laptop look branded. */
  steelLit: [0xc8, 0xcd, 0xcf, 255],
  steel: [0x9b, 0xa3, 0xa6, 255],
  steelDim: [0x6b, 0x74, 0x78, 255],
  graphite: [0x32, 0x38, 0x3b, 255],
};

/** 5x7 glyphs -- only the characters the wordmark needs. */
const FONT = {
  w: 5,
  glyphs: {
    C: [' ### ', '#   #', '#    ', '#    ', '#    ', '#   #', ' ### '],
    O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
    D: ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
    E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
    1: ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
    4: ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '],
  },
};

/** 3x5 glyphs. The 5x7 wordmark face fits about six characters across a 3-tile
 *  sign; the slogan and the street address need eight to ten, so they get their
 *  own smaller face rather than a squeezed version of the big one. */
const TINY = {
  w: 3,
  glyphs: {
    A: ['.#.', '#.#', '###', '#.#', '#.#'],
    B: ['##.', '#.#', '##.', '#.#', '##.'],
    C: ['.##', '#..', '#..', '#..', '.##'],
    D: ['##.', '#.#', '#.#', '#.#', '##.'],
    E: ['###', '#..', '##.', '#..', '###'],
    F: ['###', '#..', '##.', '#..', '#..'],
    G: ['.##', '#..', '#.#', '#.#', '.##'],
    H: ['#.#', '#.#', '###', '#.#', '#.#'],
    I: ['###', '.#.', '.#.', '.#.', '###'],
    J: ['..#', '..#', '..#', '#.#', '.#.'],
    K: ['#.#', '#.#', '##.', '#.#', '#.#'],
    L: ['#..', '#..', '#..', '#..', '###'],
    M: ['#.#', '###', '###', '#.#', '#.#'],
    // The diagonal is the whole letter: the usual solid-middle 3x5 N is
    // indistinguishable from M at this size.
    N: ['#.#', '##.', '###', '.##', '#.#'],
    // O is square and zero is round, so the two never trade places -- the
    // reverse convention would collide with the boxy D and G beside it.
    O: ['###', '#.#', '#.#', '#.#', '###'],
    P: ['##.', '#.#', '##.', '#..', '#..'],
    Q: ['.#.', '#.#', '#.#', '##.', '.##'],
    R: ['##.', '#.#', '##.', '#.#', '#.#'],
    S: ['.##', '#..', '.#.', '..#', '##.'],
    T: ['###', '.#.', '.#.', '.#.', '.#.'],
    U: ['#.#', '#.#', '#.#', '#.#', '###'],
    V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
    W: ['#.#', '#.#', '###', '###', '#.#'],
    X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
    Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
    Z: ['###', '..#', '.#.', '#..', '###'],
    0: ['.#.', '#.#', '#.#', '#.#', '.#.'],
    1: ['.#.', '##.', '.#.', '.#.', '###'],
    2: ['##.', '..#', '.#.', '#..', '###'],
    3: ['###', '..#', '.##', '..#', '###'],
    4: ['#.#', '#.#', '###', '..#', '..#'],
    5: ['###', '#..', '##.', '..#', '##.'],
    6: ['.##', '#..', '###', '#.#', '###'],
    7: ['###', '..#', '.#.', '#..', '#..'],
    8: ['###', '#.#', '###', '#.#', '###'],
    9: ['###', '#.#', '###', '..#', '##.'],
  },
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

  /** Fill a list of [y, xFrom, xTo] row spans. Curves at this size are easier
   *  to get right by listing the rows than by rounding an ellipse equation --
   *  the equation is always a pixel off somewhere and you fix it by hand anyway. */
  spans(rows, rgba) {
    for (const [y, x0, x1] of rows) this.rect(x0, y, x1 - x0 + 1, 1, rgba);
  }

  text(str, x, y, rgba, scale = 1, font = FONT) {
    let cx = x;
    for (const ch of str) {
      const glyph = font.glyphs[ch];
      if (!glyph) {
        cx += (font.w + 1) * scale;
        continue;
      }
      glyph.forEach((row, gy) => {
        [...row].forEach((cell, gx) => {
          if (cell !== '#') return;
          this.rect(cx + gx * scale, y + gy * scale, scale, scale, rgba);
        });
      });
      cx += (font.w + 1) * scale;
    }
    return cx - x - scale; // width drawn, minus the trailing gap
  }

  static textWidth(str, scale = 1, font = FONT) {
    return str.length * (font.w + 1) * scale - scale;
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

/** Defaults describe a wall piece, because that is what most of these are; the
 *  `opts` override is how the desk-top props opt out of hanging on a wall. */
function emit(id, name, canvas, footprintW, footprintH, opts = {}) {
  const {
    category = 'wall',
    canPlaceOnWalls = category === 'wall',
    canPlaceOnSurfaces = false,
    backgroundTiles = 0,
  } = opts;
  const dir = join(FURNITURE, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.png`), canvas.toPng());
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        id,
        name,
        category,
        type: 'asset',
        canPlaceOnWalls,
        canPlaceOnSurfaces,
        backgroundTiles,
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

/**
 * Emit a screen as an on/off pair.
 *
 * The office already swaps PC_FRONT_OFF for PC_FRONT_ON when someone works at
 * that desk, and it finds the pair by matching `groupId` + `state`. `groupId`
 * is just the manifest id, so a flat two-member state group is all it takes --
 * no rotation scheme, no animation frames. A dark screen on every desk while
 * the retro PCs glow would look like the new hardware was broken.
 */
function emitStates(id, name, canvases, footprintW, footprintH, opts = {}) {
  const { category = 'electronics', canPlaceOnSurfaces = true, backgroundTiles = 1 } = opts;
  const dir = join(FURNITURE, id);
  mkdirSync(dir, { recursive: true });
  const members = Object.entries(canvases).map(([state, canvas]) => {
    const memberId = `${id}_${state.toUpperCase()}`;
    writeFileSync(join(dir, `${memberId}.png`), canvas.toPng());
    return {
      type: 'asset',
      id: memberId,
      file: `${memberId}.png`,
      width: canvas.w,
      height: canvas.h,
      footprintW,
      footprintH,
      state,
    };
  });
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        id,
        name,
        category,
        type: 'group',
        groupType: 'state',
        canPlaceOnWalls: false,
        canPlaceOnSurfaces,
        backgroundTiles,
        members,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`  ✓ ${id}  ${members.length} states  ${members[0].width}x${members[0].height}`);
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

// ── The slogan off code14.nl's own masthead, 3 tiles wide ────
{
  // Taller than the other signs by a tile-fraction: three lines plus the accent
  // rule need every row, and the wall pieces are 32px regardless.
  const c = new Canvas(48, 32);
  c.panel(1, 4, 46, 24, C.dark, C.paper);
  // A coral rule under the top border stands in for the site's accent bar; a
  // fourth line of text would not fit and the sign would read as a paragraph.
  c.rect(3, 6, 42, 1, C.coral);
  // Broken across three lines because the widest word only just clears the
  // panel -- one line would need a face too small to read at 1x zoom.
  ['BUSINESS', 'THINKERS', 'DOING TECH'].forEach((line, i) => {
    const w = Canvas.textWidth(line, 1, TINY);
    c.text(line, Math.round((48 - w) / 2), 8 + i * 6, C.darker, 1, TINY);
  });
  emit('CODE14_SLOGAN', 'Business Thinkers Sign', c, 3, 2);
}

// ── The clubhouse address: Hogepad 81, Rijssen ───────────────
{
  const c = new Canvas(48, 32);
  // Two stubby posts above the plate so it reads as bolted to the wall rather
  // than floating -- Dutch street plates are always mounted, never hung.
  c.rect(11, 5, 2, 4, C.dark);
  c.rect(35, 5, 2, 4, C.dark);
  c.panel(1, 8, 46, 16, C.dark, C.paper);
  const street = 'HOGEPAD';
  const number = '81';
  const streetW = Canvas.textWidth(street, 1, TINY);
  const numberW = Canvas.textWidth(number, 1, TINY);
  const gap = 4;
  const x0 = Math.round((48 - (streetW + gap + numberW)) / 2);
  c.text(street, x0, 13, C.darker, 1, TINY);
  // The house number in coral: the one spot on a monochrome plate where the
  // brand accent can land without making it stop looking like a street sign.
  c.text(number, x0 + streetW + gap, 13, C.coral, 1, TINY);
  emit('HOGEPAD_SIGN', 'Hogepad 81 Sign', c, 3, 2);
}

// ── Gehaktbalwoensdag: the weekly meatball pan ───────────────
{
  const c = new Canvas(16, 16);
  // Handle first, so the pan rim overdraws where the two meet.
  c.rect(12, 7, 4, 2, C.darker);
  c.rect(15, 6, 1, 4, C.darker);
  const rim = [
    [4, 3, 10],
    [5, 1, 12],
    [6, 0, 13],
    [7, 0, 13],
    [8, 0, 13],
    [9, 0, 13],
    [10, 0, 13],
    [11, 1, 12],
    [12, 3, 10],
  ];
  c.spans(rim, C.dark);
  // A pale enamel dish, not a black skillet: brown on near-black is invisible
  // at 16px, and the office serves these, it does not fry them at the desk.
  c.spans(
    [
      [5, 4, 9],
      [6, 2, 11],
      [7, 1, 12],
      [8, 1, 12],
      [9, 1, 12],
      [10, 2, 11],
      [11, 4, 9],
    ],
    C.mint,
  );
  // Squares read as croutons; dropping the four corners is the smallest change
  // that makes a 4px blob read as round.
  const ball = (x, y, w) => {
    c.rect(x, y, w, w, C.meat);
    for (const [dx, dy] of [
      [0, 0],
      [w - 1, 0],
      [0, w - 1],
      [w - 1, w - 1],
    ]) {
      c.set(x + dx, y + dy, C.mint);
    }
    c.set(x + 1, y, C.meatLit);
  };
  // Piled rather than lined up -- a row of three reads as a domino.
  ball(2, 6, 4);
  ball(7, 6, 4);
  ball(5, 9, 3);
  emit('GEHAKTBAL_PAN', 'Gehaktbal Pan', c, 1, 1, {
    category: 'misc',
    canPlaceOnSurfaces: true,
  });
}

// ── The daily bakery run: a basket of bread ──────────────────
{
  const c = new Canvas(16, 16);
  // One wide loaf rather than two small ones: two overlapping blobs at this
  // size read as a single lumpy shape anyway, so the overlap buys nothing.
  c.spans(
    [
      [3, 5, 10],
      [4, 3, 12],
      [5, 2, 13],
      [6, 2, 13],
      [7, 2, 13],
      [8, 2, 13],
    ],
    C.crumb,
  );
  c.spans(
    [
      [7, 2, 13],
      [8, 2, 13],
    ],
    C.crust,
  );
  // The bakery slashes are what make this bread and not a brick -- they are the
  // only feature carrying the read once the loaf is six pixels tall.
  for (const [x, y] of [
    [4, 6],
    [5, 5],
    [7, 6],
    [8, 5],
    [10, 6],
    [11, 5],
  ]) {
    c.set(x, y, C.crust);
    c.set(x, y - 1, C.crust);
  }
  // Basket: a dark rim, wicker uprights, and a base one pixel narrower so the
  // whole thing tapers instead of reading as a crate.
  c.rect(0, 9, 16, 2, C.dark);
  c.rect(1, 11, 14, 3, C.crust);
  c.rect(2, 14, 12, 1, C.dark);
  for (const x of [3, 6, 9, 12]) c.rect(x, 11, 1, 3, C.dark);
  emit('BREAD_BASKET', 'Bakery Bread Basket', c, 1, 1, {
    category: 'misc',
    canPlaceOnSurfaces: true,
  });
}

// ── The padel racket from the office tournaments ─────────────
{
  const c = new Canvas(16, 32);
  const head = [
    [4, 5, 10],
    [5, 3, 12],
    [6, 2, 13],
    [7, 1, 14],
    [8, 1, 14],
    [9, 1, 14],
    [10, 1, 14],
    [11, 1, 14],
    [12, 1, 14],
    [13, 1, 14],
    [14, 1, 14],
    [15, 2, 13],
    [16, 3, 12],
    [17, 4, 11],
    [18, 5, 10],
    [19, 6, 9],
  ];
  c.spans(head, C.dark);
  // The face is the frame inset by two on every side; deriving it keeps the
  // frame an even thickness all the way round the teardrop.
  const face = head.slice(2, -2).map(([y, x0, x1]) => [y, x0 + 2, x1 - 2]);
  c.spans(face, C.coral);
  // A padel racket is solid and perforated, not strung -- the hole grid is the
  // only thing that stops this reading as a ping-pong bat.
  for (const [y, x0, x1] of face) {
    for (let x = x0; x <= x1; x++) {
      if (x % 3 === 0 && y % 3 === 0) c.set(x, y, C.darker);
    }
  }
  c.rect(6, 19, 4, 3, C.dark);
  c.rect(6, 22, 4, 6, C.darker);
  for (const y of [23, 25]) c.rect(6, y, 4, 1, C.mint);
  c.rect(5, 28, 6, 2, C.dark);
  emit('PADEL_RACKET', 'Padel Racket', c, 1, 2);
}

// ── The ISO 27001 certificate every consultancy hangs up ─────
{
  const c = new Canvas(32, 32);
  c.panel(1, 2, 30, 27, C.dark, C.paper);
  // A mint mat inside the frame: without it the paper meets the frame flat and
  // the piece reads as a blank sign rather than as something framed.
  c.rect(3, 4, 26, 23, C.mint);
  c.rect(5, 6, 22, 19, C.paper);
  const line = (str, y, rgba) => {
    const w = Canvas.textWidth(str, 1, TINY);
    c.text(str, Math.round((32 - w) / 2), y, rgba, 1, TINY);
  };
  line('ISO', 8, C.darker);
  line('27001', 14, C.darker);
  // Two ruled signature lines and a stamp in the corner. A centred disc with
  // ribbon tails below it just reads as a little robot at this size; a corner
  // stamp beside signature lines is what actually says "certificate".
  c.rect(6, 20, 9, 1, C.steelDim);
  c.rect(6, 23, 7, 1, C.steelDim);
  c.spans(
    [
      [18, 20, 23],
      [19, 19, 24],
      [20, 19, 24],
      [21, 19, 24],
      [22, 19, 24],
      [23, 20, 23],
    ],
    C.coral,
  );
  // Punched out to a ring, which is how a wax seal or an embossed stamp reads
  // once it is six pixels across.
  c.rect(21, 20, 2, 2, C.paper);
  emit('ISO_CERTIFICATE', 'ISO 27001 Certificate', c, 2, 2);
}

/** Draw a lit screen: pale ground with a few coral and mint code lines.
 *  Ragged line lengths are the whole trick -- even bars read as a test card. */
function codeLines(c, x0, y0, x1, y1) {
  c.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, C.paleMint);
  const widths = [0.55, 0.8, 0.35, 0.7, 0.45, 0.6];
  const span = x1 - x0 + 1;
  for (let i = 0, y = y0 + 1; y <= y1 - 1; y += 2, i++) {
    const w = Math.max(2, Math.round(span * widths[i % widths.length]) - 2);
    // The first token of each line in coral, the rest in mint, so the screen
    // reads as syntax-highlighted code rather than as a striped pattern.
    c.rect(x0 + 1, y, 2, 1, C.coral);
    c.rect(x0 + 4, y, w - 3, 1, C.mint);
  }
}

// ── An open MacBook, to sit beside the beige boxes ───────────
// The bundled PC fills rows 0..22 of its 16x32 sprite, with the desk plane at
// row 17. Everything below matches that plane so the new kit shares an eye-line
// with the furniture already in the office; a laptop is simply shorter.
{
  const build = (lit) => {
    const c = new Canvas(16, 32);
    // Lid: a thin dark bezel, which is most of what separates a current laptop
    // from the CRT next to it.
    c.rect(1, 6, 14, 11, C.graphite);
    if (lit) {
      codeLines(c, 2, 7, 13, 14);
    } else {
      c.rect(2, 7, 12, 8, C.darker);
      c.rect(2, 7, 12, 1, C.steelDim); // one sheen row, so it is off, not a hole
    }
    c.rect(2, 17, 12, 1, C.steelDim); // hinge
    // The deck is drawn wider than the lid on purpose. Without that overhang
    // the two stack into one silhouette and the whole thing reads as a small
    // monitor on a stand, which is exactly what the first attempt looked like.
    c.rect(0, 18, 16, 4, C.steel);
    c.rect(0, 22, 16, 1, C.steelLit); // front lip catching the light
    // Individual key pixels rather than a solid well: a filled rectangle here
    // reads as a shadow, and the key texture is what names the object.
    for (let x = 2; x <= 13; x += 2) {
      c.rect(x, 18, 1, 1, C.graphite);
      c.rect(x, 19, 1, 1, C.graphite);
    }
    c.rect(6, 21, 4, 1, C.steelDim); // trackpad
    return c;
  };
  emitStates('MACBOOK', 'MacBook', { off: build(false), on: build(true) }, 1, 2);
}

// A closed MacBook was tried here and dropped. At 16px a shut laptop is a grey
// slab four pixels tall; every detail that would name it -- the lid seam, the
// finger notch, the taper -- lands on the same one or two rows, and the result
// read as a radiator vent. There is no version of it worth a palette slot.

// ── A modern widescreen monitor ──────────────────────────────
{
  const build = (lit) => {
    const c = new Canvas(32, 32);
    // 30x17 outer, which is 16:9 to within a pixel, against the CRT's near
    // square face -- the aspect ratio is what sells "modern" at this size.
    c.rect(1, 0, 30, 17, C.graphite);
    if (lit) {
      codeLines(c, 2, 1, 29, 13);
    } else {
      c.rect(2, 1, 28, 13, C.darker);
      c.rect(2, 1, 28, 1, C.steelDim);
    }
    // A chin two pixels deep, so the thin side bezels read as deliberate.
    c.rect(1, 14, 30, 3, C.graphite);
    c.rect(15, 15, 2, 1, C.steelDim);
    c.rect(14, 17, 4, 4, C.steel); // neck
    c.rect(8, 21, 16, 2, C.steelDim); // blade foot
    c.rect(8, 21, 16, 1, C.steel);
    return c;
  };
  emitStates('MONITOR', 'Widescreen Monitor', { off: build(false), on: build(true) }, 2, 2);
}

// ── An ultrawide, for the people with two terminals open ─────
{
  const build = (lit) => {
    const c = new Canvas(48, 32);
    c.rect(1, 2, 46, 15, C.graphite);
    if (lit) {
      codeLines(c, 2, 3, 45, 12);
      // A seam down the middle: an ultrawide is only worth having as a separate
      // piece if it is visibly split into two working halves.
      c.rect(23, 3, 1, 10, C.graphite);
      c.rect(24, 3, 1, 10, C.dark);
    } else {
      c.rect(2, 3, 44, 10, C.darker);
      c.rect(2, 3, 44, 1, C.steelDim);
    }
    c.rect(1, 13, 46, 4, C.graphite);
    c.rect(23, 14, 2, 1, C.steelDim);
    c.rect(22, 17, 4, 4, C.steel);
    c.rect(14, 21, 20, 2, C.steelDim);
    c.rect(14, 21, 20, 1, C.steel);
    return c;
  };
  emitStates('ULTRAWIDE', 'Ultrawide Monitor', { off: build(false), on: build(true) }, 3, 2);
}

console.log('CODE14 assets written to webview-ui/public/assets/furniture/');
