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

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

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
  /* Sampled straight out of the bundled DESK/DESK_FRONT.png. MACBOOK_DESK has
   * to look like the same furniture line standing next to it, so these are
   * matched rather than invented -- a second wood tone would read as a
   * different desk that happens to be the same shape. */
  /* A white sit-stand desk, the kind actually standing in the office. Kept as
   * four near-whites rather than one: at this size the only thing separating a
   * white slab from a white wall is the edge shading. */
  white: [0xf4, 0xf5, 0xf6, 255],
  whiteLit: [0xff, 0xff, 0xff, 255],
  whiteEdge: [0xd3, 0xd8, 0xdb, 255],
  whiteShadow: [0xa8, 0xaf, 0xb4, 255],
  wood: [0xb3, 0x88, 0x57, 255],
  woodLit: [0xcf, 0xa8, 0x6d, 255],
  woodEdge: [0x88, 0x5c, 0x47, 255],
  woodShadow: [0x53, 0x2e, 0x3d, 255],
  legDark: [0x39, 0x44, 0x49, 255],
  legLit: [0x73, 0x78, 0x7e, 255],
  underDesk: [0x00, 0x00, 0x00, 255],
  /* The black mesh task chairs at the desks. Three near-blacks rather than one:
   * a flat black loses the backrest against the seat and the star base against
   * the floor, and the tone step is the only separation a 16px sprite has. */
  chairFrame: [0x14, 0x17, 0x19, 255],
  chairMesh: [0x24, 0x28, 0x2c, 255],
  chairMeshLit: [0x3b, 0x42, 0x47, 255],
  /* The one non-black on the chair. Castor hubs catch the light, and without
   * that glint the base reads as a smudge of shadow instead of wheels. */
  castor: [0x5c, 0x64, 0x69, 255],
  /* Matches the contact shadow the bundled chairs already sit on, so a mixed
   * row of old and new chairs shares one floor. */
  contact: [0x00, 0x00, 0x00, 51],
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

/**
 * Read one of the bundled PNGs back in.
 *
 * MACBOOK_DESK is composited straight onto the project's own DESK_FRONT rather
 * than redrawing a desk beside it. A hand-drawn copy would drift: one pixel of
 * difference in the desk plane and the new workstation no longer lines up with
 * the desks already in the office. Reading the real sprite makes that
 * impossible, and means a future change to DESK_FRONT is picked up by a re-run.
 */
function readPng(file) {
  const d = readFileSync(file);
  let pos = 8;
  let w = 0;
  let h = 0;
  const idat = [];
  while (pos < d.length) {
    const len = d.readUInt32BE(pos);
    const type = d.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') {
      w = d.readUInt32BE(pos + 8);
      h = d.readUInt32BE(pos + 12);
    } else if (type === 'IDAT') {
      idat.push(d.subarray(pos + 8, pos + 8 + len));
    }
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const px = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0, i = 0; y < h; y++) {
    const filter = raw[i++];
    const line = new Uint8Array(raw.subarray(i, i + stride));
    i += stride;
    // All five filter types: the bundled art is not written unfiltered the way
    // this generator writes its own output.
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    px.set(line, y * stride);
    prev = line;
  }
  return { w, h, px };
}

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

  /** Paint another image in, keeping this canvas's pixels where the source is
   *  transparent. Used to stand a prop on top of a bundled sprite. */
  blit(src, x = 0, y = 0) {
    for (let sy = 0; sy < src.h; sy++) {
      for (let sx = 0; sx < src.w; sx++) {
        const o = (sy * src.w + sx) * 4;
        if (src.px[o + 3] < 8) continue;
        this.set(x + sx, y + sy, [src.px[o], src.px[o + 1], src.px[o + 2], src.px[o + 3]]);
      }
    }
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

/**
 * Emit a chair as a front/back/side rotation group.
 *
 * Shaped to match the bundled CUSHIONED_CHAIR manifest rather than invented:
 * the editor's R key cycles a group's orientations, and `layoutToSeats` reads
 * `orientation` to decide which way the occupant faces. `mirrorSide` on the
 * side member is what gives the fourth direction without a fourth sprite.
 */
function emitRotation(id, name, canvases, footprintW, footprintH) {
  const dir = join(FURNITURE, id);
  mkdirSync(dir, { recursive: true });
  const members = Object.entries(canvases).map(([orientation, canvas]) => {
    const memberId = `${id}_${orientation.toUpperCase()}`;
    writeFileSync(join(dir, `${memberId}.png`), canvas.toPng());
    return {
      type: 'asset',
      id: memberId,
      file: `${memberId}.png`,
      width: canvas.w,
      height: canvas.h,
      footprintW,
      footprintH,
      orientation,
      ...(orientation === 'side' ? { mirrorSide: true } : {}),
    };
  });
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        id,
        name,
        category: 'chairs',
        type: 'group',
        groupType: 'rotation',
        rotationScheme: '3-way-mirror',
        canPlaceOnWalls: false,
        canPlaceOnSurfaces: false,
        backgroundTiles: 0,
        members,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `  ✓ ${id}  ${members.length} orientations  ${members[0].width}x${members[0].height}`,
  );
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

/**
 * Draw an open MacBook with its lid's top-left corner at (lx, ly).
 *
 * Shared rather than copied because the standalone laptop and the one bolted to
 * MACBOOK_DESK have to be the same machine -- two hand-tuned copies would drift
 * apart the first time either is nudged, and the pair sits side by side in the
 * same office where any size difference is obvious.
 */
function drawMacbook(c, lx, ly, lit) {
  // Lid: a thin dark bezel, which is most of what separates a current laptop
  // from the CRT next to it.
  c.rect(lx, ly, 14, 11, C.graphite);
  if (lit) {
    codeLines(c, lx + 1, ly + 1, lx + 12, ly + 8);
  } else {
    c.rect(lx + 1, ly + 1, 12, 8, C.darker);
    c.rect(lx + 1, ly + 1, 12, 1, C.steelDim); // one sheen row, so it is off, not a hole
  }
  c.rect(lx + 1, ly + 11, 12, 1, C.steelDim); // hinge
  // The deck is drawn wider than the lid on purpose. Without that overhang the
  // two stack into one silhouette and the whole thing reads as a small monitor
  // on a stand, which is exactly what the first attempt looked like.
  c.rect(lx - 1, ly + 12, 16, 4, C.steel);
  c.rect(lx - 1, ly + 16, 16, 1, C.steelLit); // front lip catching the light
  // Individual key pixels rather than a solid well: a filled rectangle here
  // reads as a shadow, and the key texture is what names the object.
  for (let x = lx + 1; x <= lx + 12; x += 2) {
    c.rect(x, ly + 12, 1, 1, C.graphite);
    c.rect(x, ly + 13, 1, 1, C.graphite);
  }
  c.rect(lx + 5, ly + 15, 4, 1, C.steelDim); // trackpad
}

// ── An open MacBook, to sit beside the beige boxes ───────────
// The bundled PC fills rows 0..22 of its 16x32 sprite, with the desk plane at
// row 17. Everything below matches that plane so the new kit shares an eye-line
// with the furniture already in the office; a laptop is simply shorter.
{
  const build = (lit) => {
    const c = new Canvas(16, 32);
    drawMacbook(c, 1, 6, lit);
    return c;
  };
  emitStates('MACBOOK', 'MacBook', { off: build(false), on: build(true) }, 1, 2);
}

/**
 * A laptop small enough to stand on a desk, its deck landing on the desk plane
 * at `deck` (default row 11, the plane of the bundled DESK_FRONT).
 *
 * The plane is a parameter and not a constant because the two desk variants no
 * longer share a surface height: a laptop hovering above the desktop or sunk
 * into it is a worse fault than any proportion of the desk under it.
 *
 * Deliberately smaller than the standalone MACBOOK sprite: that one owns a
 * whole tile and is seventeen rows tall, which would make it the size of a
 * wardrobe on a three-tile desk. Shared by both desk variants so the wooden and
 * the white workstation carry the same machine.
 */
function drawDeskLaptop(c, x, lit, deck = 11) {
  const lid = deck - 10;
  // Lid: graphite shell, screen inset by one pixel all round.
  c.rect(x + 1, lid, 12, 9, C.graphite);
  if (lit) {
    codeLines(c, x + 2, lid + 1, x + 11, lid + 7);
  } else {
    c.rect(x + 2, lid + 1, 10, 7, C.darker);
    c.rect(x + 2, lid + 1, 10, 1, C.steelDim); // a sheen row, so it reads off and not hollow
  }
  c.rect(x + 1, deck - 1, 12, 1, C.steelDim); // hinge
  // The deck overhangs the lid on both sides. Without that the lid and deck
  // stack into one silhouette and the whole thing reads as a tiny monitor.
  c.rect(x, deck, 14, 2, C.steel);
  c.rect(x, deck + 2, 14, 1, C.steelLit); // front lip catching the light
  for (let kx = x + 2; kx <= x + 11; kx += 2) c.rect(kx, deck, 1, 1, C.graphite);
  c.rect(x + 5, deck + 1, 4, 1, C.steelDim); // trackpad
}

// ── A desk with a MacBook on it: somewhere to actually sit ───
// A workstation in one piece. The desk is the project's own DESK_FRONT,
// composited rather than redrawn, so the plane and silhouette match the desks
// already in the office exactly.
//
// Two things make this function rather than merely look right. `category:
// "desks"` is what assetLoader turns into `isDesk`, which is what makes
// characters treat it as a workstation and chairs orient toward it. And the
// off/on pair is what officeState's rebuildFurnitureInstances swaps when
// somebody sits facing it -- that logic keys on the state group, not on the
// category, so a desk lights up just as an electronics item does.
{
  const desk = readPng(join(FURNITURE, 'DESK', 'DESK_FRONT.png'));

  const build = (lit) => {
    const c = new Canvas(48, 32);
    c.blit(desk);
    // Centred on the desk, the deck overlapping its surface by a pixel so the
    // laptop sits ON the wood rather than hovering a hair above it.
    drawDeskLaptop(c, 17, lit);
    return c;
  };

  emitStates('MACBOOK_DESK', 'MacBook Desk', { off: build(false), on: build(true) }, 3, 2, {
    category: 'desks',
    canPlaceOnSurfaces: false,
    backgroundTiles: 1,
  });
}

// ── White sit-stand desks ────────────────────────────────────
// The office runs on white height-adjustable desks with T-feet, not the wooden
// one the project ships. Drawn rather than recoloured: the bundled desk is a
// closed box with a solid front, and the thing that actually names this desk is
// the gap under the top and the shape of the legs.
//
// Sprite bottom stays at row 31 and the footprint at 3x2, which is what keeps
// these aligned beside the wooden desks and under the chairs. The surface sits
// a row above DESK_FRONT's plane and the slab is twice as thick: a five-row top
// on fifteen rows of leg read as a shelf on stilts rather than as a desk.
{
  /** The desk plane. One row above DESK_FRONT's, which is as high as it can go
   *  while the laptop lid still fits inside the sprite. */
  const DECK = 10;

  const drawWhiteDesk = (c) => {
    // Top slab, lit along its back edge so it reads as a surface and not a wall.
    c.rect(2, DECK, 44, 1, C.whiteLit);
    c.rect(2, DECK + 1, 44, 7, C.white);
    c.rect(2, DECK + 8, 44, 1, C.whiteEdge);
    // A one-pixel shadow directly beneath the slab gives it thickness.
    c.rect(3, DECK + 9, 42, 1, C.whiteShadow);

    // Two T-legs, back at their original slim proportions. Widening the posts
    // was tried and rejected: the frame is not what looked wrong, the thin
    // tabletop above it was, and a chunkier post just made the desk heavy. The
    // space between the legs stays transparent -- an open underside is most of
    // what distinguishes this from the boxed-in wooden desk at a glance.
    for (const x of [9, 34]) {
      c.rect(x, 19, 4, 10, C.white);
      c.rect(x + 3, 19, 1, 10, C.whiteEdge); // right-hand edge catches shade
      c.rect(x - 3, 29, 10, 2, C.white);
      c.rect(x - 3, 31, 10, 1, C.whiteShadow);
    }
  };

  {
    const c = new Canvas(48, 32);
    drawWhiteDesk(c);
    emit('WHITE_DESK', 'White Desk', c, 3, 2, {
      category: 'desks',
      canPlaceOnWalls: false,
      canPlaceOnSurfaces: false,
      backgroundTiles: 1,
    });
  }

  // The same desk with a laptop on it, so one piece is a whole workstation.
  const build = (lit) => {
    const c = new Canvas(48, 32);
    drawWhiteDesk(c);
    drawDeskLaptop(c, 17, lit, DECK);
    return c;
  };
  emitStates(
    'WHITE_DESK_MACBOOK',
    'White Desk with MacBook',
    { off: build(false), on: build(true) },
    3,
    2,
    {
      category: 'desks',
      canPlaceOnSurfaces: false,
      backgroundTiles: 1,
    },
  );
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

// ── The black mesh task chair actually at the desks ──────────
{
  /* 16x16 on a 1x1 footprint, base on row 15, matching CUSHIONED_CHAIR exactly.
   * Seats are derived per footprint tile and characters are drawn against the
   * tile, so a taller sprite or a different floor row would both misalign the
   * occupant and split one chair into several seats. */

  /** Mesh, as a weave rather than a fill: a checker of the lighter tone is the
   *  only texture that survives 16px, and it is what stops the backrest reading
   *  as the same solid slab as the seat pan. */
  const mesh = (c, x0, y0, x1, y1) => {
    c.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, C.chairMesh);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if ((x + y) % 2 === 0) c.set(x, y, C.chairMeshLit);
    }
  };

  /* The five-star base is the single strongest "office chair" signal at this
   * size, so all three views share one drawing -- a star looks much the same
   * from any angle, and redrawing it per view only invites them to drift. */
  const starBase = (c, cx) => {
    c.rect(cx - 2, 13, 6, 1, C.chairFrame); // hub the column drops into
    // Three clusters, not one bar: the gaps at cx-3 and cx+4 are what separate
    // the splayed arms from each other.
    c.rect(cx - 5, 14, 3, 1, C.chairFrame);
    c.rect(cx - 1, 14, 4, 1, C.chairFrame);
    c.rect(cx + 3, 14, 3, 1, C.chairFrame);
    for (const x of [cx - 6, cx - 2, cx + 2, cx + 5]) {
      c.rect(x, 15, 2, 1, C.chairFrame);
      c.set(x, 15, C.castor); // the glint that turns a dark blob into a wheel
    }
    c.spans(
      [
        [15, cx - 4, cx - 3],
        [15, cx, cx + 1],
        [15, cx + 4, cx + 4],
      ],
      C.contact,
    );
  };

  /** Thin black arms, drawn as a pad over a drop post. */
  const armrests = (c, y) => {
    for (const x of [1, 13]) {
      c.rect(x, y, 2, 1, C.chairFrame);
      c.set(x === 1 ? 1 : 14, y + 1, C.chairFrame);
    }
  };

  const back = () => {
    const c = new Canvas(16, 16);
    /* Back-facing chairs are z-sorted IN FRONT of their occupant, so a filled
     * headrest would erase the agent's head. Drawn as an open ring instead --
     * which is also what a mesh headrest honestly looks like from behind. */
    c.rect(4, 1, 8, 1, C.chairFrame);
    c.set(4, 2, C.chairFrame);
    c.set(11, 2, C.chairFrame);
    c.rect(4, 3, 8, 1, C.chairFrame);
    c.set(5, 4, C.chairFrame); // the two stalks, and the gap that reads as one
    c.set(10, 4, C.chairFrame);
    c.rect(3, 5, 10, 1, C.chairFrame);
    mesh(c, 3, 6, 12, 10);
    c.rect(3, 6, 1, 5, C.chairFrame);
    c.rect(12, 6, 1, 5, C.chairFrame);
    c.rect(3, 11, 10, 1, C.chairFrame);
    armrests(c, 9);
    c.rect(2, 12, 12, 1, C.chairFrame); // seat pan, all that shows from behind
    starBase(c, 7);
    return c;
  };

  const front = () => {
    const c = new Canvas(16, 16);
    c.rect(4, 0, 8, 1, C.chairFrame);
    mesh(c, 4, 1, 11, 1);
    c.rect(4, 2, 8, 1, C.chairFrame);
    c.set(5, 3, C.chairFrame);
    c.set(10, 3, C.chairFrame);
    c.rect(3, 4, 10, 1, C.chairFrame);
    mesh(c, 3, 5, 12, 8);
    c.rect(3, 5, 1, 4, C.chairFrame);
    c.rect(12, 5, 1, 4, C.chairFrame);
    c.rect(3, 9, 10, 1, C.chairFrame);
    armrests(c, 8);
    c.rect(2, 10, 12, 1, C.chairMesh); // seat cushion, lit against its own edge
    c.rect(3, 10, 10, 1, C.chairMeshLit);
    c.rect(2, 11, 12, 1, C.chairFrame);
    c.rect(7, 12, 2, 1, C.castor); // gas lift, the one place the column shows
    starBase(c, 7);
    return c;
  };

  const side = () => {
    const c = new Canvas(16, 16);
    c.rect(0, 0, 4, 3, C.chairFrame);
    mesh(c, 1, 1, 2, 1);
    c.rect(1, 3, 2, 1, C.chairFrame); // stalk pair, seen edge-on as one post
    c.rect(0, 4, 4, 8, C.chairFrame);
    mesh(c, 1, 5, 2, 10);
    // Seat pan as a slab, not a line: in profile the pan is the only part wide
    // enough to say how deep the chair is, and a 1px line says "stool".
    c.rect(4, 9, 9, 1, C.chairMeshLit);
    c.rect(4, 10, 9, 1, C.chairMesh);
    c.rect(3, 11, 10, 1, C.chairFrame);
    c.rect(5, 6, 7, 1, C.chairFrame); // armrest bar, on its front post
    c.rect(11, 7, 1, 2, C.chairFrame);
    c.rect(5, 12, 2, 1, C.castor);
    starBase(c, 6);
    return c;
  };

  emitRotation(
    'OFFICE_CHAIR',
    'Office Chair',
    { front: front(), back: back(), side: side() },
    1,
    1,
  );
}

console.log('CODE14 assets written to webview-ui/public/assets/furniture/');
