#!/usr/bin/env node
/**
 * Generate the second wave of CODE14 office props as pixel art.
 *
 * Sibling of scripts/generate-brand-assets.mjs: same reasoning (sprites are
 * described in code so a palette change is a re-run, not a repaint), same
 * output directory, deliberately its own file so the two can be edited without
 * stepping on each other.
 *
 *   node scripts/generate-office-props.mjs
 *
 * Where the first wave was CODE14 branding and desk hardware, this one is the
 * stuff that makes an office look inhabited rather than furnished: the pin
 * board, the coat rack, the coffee machine, the lounge.
 *
 * Props considered and deliberately NOT built -- do not retry these blind:
 *   - Monstera / fiddle-leaf plant. LARGE_PLANT is already a 32x48 broad-leaf
 *     plant; a monstera's split leaves need the fenestrations to read, and at
 *     one leaf per 5px they just look like chewed LARGE_PLANT.
 *   - Bakfiets. Two wheels, a box and a frame need ~40px of width before the
 *     wheels stop being squares, and at 3 tiles wide it would tower over the
 *     desks it parks next to.
 *   - Foosball table. Identical silhouette to the ping-pong table below once
 *     the rods (1px) and players (2px) vanish into the playfield.
 *   - Cable trays. They live under the desk plane, so the renderer would draw
 *     the desk on top of them and nobody would ever see the sprite.
 *   - Stroopwafel tin. A 1x1 round tin is a disc with a highlight -- it reads
 *     as a coaster or a plate. The bakery bag below carries the same joke and
 *     has a silhouette.
 *   - Wall clock variants. CLOCK exists; a second circle-on-a-wall differs
 *     only in hand angle, which is not variety.
 *   - A tiled floor patch to sell the bathroom. Floors are a different asset
 *     type entirely (assets/floors/, a 7-pattern grayscale strip recoloured by
 *     the HSBC sliders), not furniture -- and the editor can already recolour
 *     an existing pattern cool and pale for a washroom corner.
 *   - Fruit bowl. At 1x1 a rimmed container with coloured lumps in it is the
 *     BREAD_BASKET silhouette exactly; the office already has that sprite.
 *   - Pedal bin. BIN exists. A pedal is two pixels.
 *   - Integrated dishwasher, and a floor-standing oven. Both are the kitchen
 *     counter's cupboard door with a control strip or a dark window on it --
 *     the same sprite with different clutter. The microwave carries "there is
 *     hot food here" on its own.
 *   - A bathroom partition. As floor furniture it is a flat slab two or three
 *     tiles wide with nothing on it, and it would z-sort in front of whoever
 *     stands behind it. Walls are already a first-class tool in the editor and
 *     they auto-tile; a half-convincing partition is worse than using them.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FURNITURE = join(ROOT, 'webview-ui', 'public', 'assets', 'furniture');

/**
 * Every colour in the file, in one object -- the `pixel-agents/no-inline-colors`
 * rule lints scripts/, and a palette scattered through 600 lines of drawing
 * code is unmaintainable anyway.
 *
 * The first block is CODE14's own palette, sampled from code14.nl and kept in
 * sync with server/src/brandPalette.ts. Everything after it is a real-world
 * material the brand has no honest colour for: mint cork or a coral server
 * cabinet would read as a mistake, not as branding. Those are all held
 * deliberately desaturated so they sit beside the brand colours rather than
 * fighting them.
 */
const C = {
  dark: [0x25, 0x36, 0x37, 255],
  darker: [0x1c, 0x29, 0x2a, 255],
  coral: [0xf8, 0x83, 0x5b, 255],
  coralDim: [0xc4, 0x5f, 0x3e, 255],
  mint: [0x96, 0xb9, 0xb6, 255],
  paleMint: [0xd2, 0xe7, 0xe2, 255],
  paper: [0xf2, 0xf2, 0xf0, 255],
  muted: [0x5c, 0x6b, 0x6b, 255],
  none: [0, 0, 0, 0],
  // Cork, kraft paper and flipchart-easel beech: the warm neutrals.
  cork: [0xc4, 0x9a, 0x62, 255],
  corkLit: [0xd8, 0xb2, 0x7c, 255],
  corkDim: [0x9a, 0x74, 0x45, 255],
  kraft: [0xd2, 0xa9, 0x72, 255],
  kraftLit: [0xe6, 0xc7, 0x97, 255],
  // Appliance metal and dark plastic, shared by the cooler, the machine and
  // the rack -- three grey steps is the minimum that still shows an edge.
  steelLit: [0xc8, 0xcd, 0xcf, 255],
  steel: [0x9b, 0xa3, 0xa6, 255],
  steelDim: [0x6b, 0x74, 0x78, 255],
  graphite: [0x32, 0x38, 0x3b, 255],
  graphiteLit: [0x4a, 0x52, 0x56, 255],
  whiteLit: [0xff, 0xff, 0xff, 255],
  // Water in the cooler bottle. Deliberately not paleMint: a mint bottle on a
  // white body disappears, and everyone reads "water" as blue.
  water: [0x8f, 0xc4, 0xdc, 255],
  waterLit: [0xc3, 0xe2, 0xef, 255],
  // Wool coats on the rack, one warm and one cold so it reads as more than one
  // person's coat. Lightened from the first pass: at 6px wide, a coat
  // whose body is as dark as its own outline is just an outline.
  coatWarm: [0xa9, 0x62, 0x4a, 255],
  coatWarmDim: [0x5e, 0x33, 0x27, 255],
  coatCold: [0x53, 0x70, 0x96, 255],
  // Beanbag corduroy. A mint one came out grey and domed -- it read as a UFO
  // next to the pale floor -- so the lounge seat gets a colour of its own.
  denim: [0x4a, 0x63, 0x86, 255],
  denimLit: [0x6d, 0x89, 0xad, 255],
  denimDim: [0x2c, 0x3c, 0x52, 255],
  // A ping-pong table is this green or it is not a ping-pong table.
  felt: [0x2f, 0x6b, 0x53, 255],
  feltDim: [0x21, 0x4c, 0x3b, 255],
  // Rack status LEDs. Amber is the third state every switch has; without it a
  // rack of pure green dots reads as decoration.
  ledAmber: [0xe8, 0xb0, 0x4a, 255],
  ledOff: [0x3f, 0x47, 0x4a, 255],
  // The black void a sprite casts on the floor tile beneath it, copied from the
  // bundled tables so new furniture sits on the same ground.
  underShadow: [0x00, 0x00, 0x00, 255],
  // Sanitary porcelain. Four steps rather than one white: the office floor is
  // pale, so a toilet painted a single white is a hole in the sprite -- the
  // shading and the near-black bowl opening are the whole read.
  porcelain: [0xfa, 0xfb, 0xfb, 255],
  porcelainShade: [0xd3, 0xdb, 0xdd, 255],
  porcelainDim: [0xa9, 0xb4, 0xb8, 255],
  bowlDark: [0x46, 0x54, 0x59, 255],
  // Oak worktop. Warmer than the bakery kraft above it and a shade browner:
  // a worktop the colour of a paper bag looked like a desk had wandered in.
  oak: [0xc4, 0x9d, 0x6b, 255],
  oakLit: [0xdb, 0xba, 0x8d, 255],
  oakDim: [0x8b, 0x67, 0x42, 255],
  // Mirror glass: cooler and lighter than any wall in the office, which is the
  // only reason a frame full of flat colour reads as a mirror at all.
  glass: [0xb8, 0xd2, 0xdb, 255],
  glassLit: [0xe8, 0xf4, 0xf7, 255],
  glassDim: [0x8e, 0xac, 0xb7, 255],
};

/** 3x5 glyphs, same face as the brand generator's TINY -- the value plaques
 *  have to look like they were printed by the same shop as the ISO frame. */
const TINY = {
  w: 3,
  glyphs: {
    A: ['.#.', '#.#', '###', '#.#', '#.#'],
    B: ['##.', '#.#', '##.', '#.#', '##.'],
    C: ['.##', '#..', '#..', '#..', '.##'],
    D: ['##.', '#.#', '#.#', '#.#', '##.'],
    E: ['###', '#..', '##.', '#..', '###'],
    G: ['.##', '#..', '#.#', '#.#', '.##'],
    H: ['#.#', '#.#', '###', '#.#', '#.#'],
    K: ['#.#', '#.#', '##.', '#.#', '#.#'],
    L: ['#..', '#..', '#..', '#..', '###'],
    M: ['#.#', '###', '###', '#.#', '#.#'],
    // The diagonal is the whole letter: a solid-middle 3x5 N is
    // indistinguishable from M at this size.
    N: ['#.#', '##.', '###', '.##', '#.#'],
    O: ['###', '#.#', '#.#', '#.#', '###'],
    R: ['##.', '#.#', '##.', '#.#', '#.#'],
    S: ['.##', '#..', '.#.', '..#', '##.'],
    T: ['###', '.#.', '.#.', '.#.', '.#.'],
    W: ['#.#', '#.#', '###', '###', '#.#'],
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
    this.rect(x + 1, y + 1, w - 2, h - 2, fill);
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
   *  to get right by listing the rows than by rounding an ellipse equation. */
  spans(rows, rgba) {
    for (const [y, x0, x1] of rows) this.rect(x0, y, x1 - x0 + 1, 1, rgba);
  }

  text(str, x, y, rgba, scale = 1, font = TINY) {
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
    return cx - x - scale;
  }

  /** Centre a string on the canvas. Every plaque in here is centred, and doing
   *  the arithmetic at each call site is where off-by-one drift comes from. */
  centred(str, y, rgba, scale = 1, font = TINY) {
    const w = str.length * (font.w + 1) * scale - scale;
    this.text(str, Math.round((this.w - w) / 2), y, rgba, scale, font);
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

/** Defaults describe a wall piece, because the plaques and the pin board are
 *  the bulk of what this file emits; floor props override `category`. */
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
 * Emit a prop as an off/on pair.
 *
 * Same shape as the brand generator's helper -- the office swaps members of a
 * state group by `groupId` + `state` when someone is working nearby, so a
 * coffee machine and a server rack get to light up exactly the way the monitors
 * do. `canPlaceOnWalls` is an option here and not a constant, because unlike
 * the desk hardware one of these (the meeting light) hangs on a wall.
 */
/**
 * Emit a rotation group: several orientations of one object that the editor's
 * R key cycles through.
 *
 * A single `type: "asset"` cannot be rotated at all -- `getRotatedType` looks
 * the type up in a rotation group and returns null when it finds none, so R
 * silently does nothing. That is what made the toilet feel broken.
 *
 * `3-way-mirror` is three sprites for four placements: the side view is
 * mirrored for the fourth, which is why `mirrorSide` is set on that member.
 */
function emitRotation(id, name, canvases, footprintW, footprintH, opts = {}) {
  const {
    category = 'misc',
    canPlaceOnWalls = false,
    canPlaceOnSurfaces = false,
    backgroundTiles = 0,
  } = opts;
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
        category,
        type: 'group',
        groupType: 'rotation',
        rotationScheme: '3-way-mirror',
        canPlaceOnWalls,
        canPlaceOnSurfaces,
        backgroundTiles,
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

function emitStates(id, name, canvases, footprintW, footprintH, opts = {}) {
  const {
    category = 'electronics',
    canPlaceOnWalls = false,
    canPlaceOnSurfaces = false,
    backgroundTiles = 0,
  } = opts;
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
        canPlaceOnWalls,
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

// ── Team-trip pin board: the wall that proves people go places ──
{
  const c = new Canvas(48, 32);
  c.panel(1, 3, 46, 26, C.dark, C.cork);
  // Cork is a texture, not a colour: without the speckle this is a tan
  // rectangle and reads as a blank canvas rather than as a board.
  for (let y = 5; y < 27; y++) {
    for (let x = 3; x < 45; x++) {
      if ((x * 7 + y * 13) % 11 === 0) c.set(x, y, C.corkDim);
      else if ((x * 5 + y * 3) % 17 === 0) c.set(x, y, C.corkLit);
    }
  }
  // Pinned things, each with its pin: a photo, three notes, one hung askew.
  // The overlap and the one crooked note are what make it a board people use.
  const pinned = (x, y, w, h, fill) => {
    c.rect(x, y, w, h, fill);
    c.rect(x, y + h, w, 1, C.corkDim); // a pixel of drop shadow lifts it off
    c.set(x + Math.floor(w / 2), y, C.darker);
  };
  pinned(4, 6, 11, 9, C.paper); // holiday photo
  c.rect(5, 10, 9, 4, C.mint); // sea and sky, two bands
  c.rect(5, 7, 9, 3, C.paleMint);
  c.rect(8, 11, 3, 3, C.corkLit); // a beach, so it reads as a trip photo
  pinned(18, 5, 9, 9, C.coral);
  pinned(30, 6, 7, 10, C.paper);
  pinned(39, 7, 6, 8, C.paleMint);
  // Two rows, not one. A single line of notes across the top leaves half the
  // cork bare and reads as a board nobody has got round to using.
  pinned(5, 18, 10, 7, C.paleMint);
  pinned(18, 17, 9, 8, C.paper);
  c.rect(19, 18, 7, 4, C.coatCold); // a second photo, a group shot at night
  pinned(31, 18, 7, 7, C.coral);
  pinned(40, 18, 5, 7, C.paper);
  // Handwriting: alternating short dashes. Real glyphs at 3px inside a 9px
  // note are unreadable, and squiggles are what a sticky note looks like from
  // across a room anyway.
  for (const [x, y, w] of [
    [20, 8, 5],
    [20, 10, 4],
    [32, 9, 3],
    [32, 11, 4],
    [32, 13, 3],
    [40, 9, 4],
    [40, 11, 3],
    [7, 20, 6],
    [7, 22, 4],
    [33, 21, 3],
    [41, 20, 3],
    [41, 22, 3],
  ]) {
    c.rect(x, y, w, 1, C.muted);
  }
  emit('CORKBOARD', 'Team Pin Board', c, 3, 2);
}

// ── The two CODE14 values, as the plaques on the wall ─────────
{
  /** The same plaque twice, inverted: one dark, one paper. Two identical
   *  frames hanging side by side would read as one wide sign. */
  const plaque = (id, name, l1, l2, ground, ink, rule) => {
    const c = new Canvas(48, 32);
    c.panel(2, 4, 44, 24, C.dark, ground);
    c.centred(l1, 10, ink);
    c.centred(l2, 18, ink);
    // The rule between the lines is the only thing making this look designed
    // rather than typed.
    c.rect(17, 16, 14, 1, rule);
    emit(id, name, c, 3, 2);
  };
  plaque('VALUE_CHALLENGE', 'We Challenge Plaque', 'WE', 'CHALLENGE', C.dark, C.paper, C.coral);
  plaque(
    'VALUE_SMARTER',
    'We Work Smarter Plaque',
    'WE WORK',
    'SMARTER',
    C.paper,
    C.darker,
    C.mint,
  );
}

// ── Meeting-in-progress light, over the call room door ────────
{
  const build = (on) => {
    const c = new Canvas(16, 32);
    c.rect(7, 6, 2, 4, C.dark); // stem, so it hangs off the wall
    c.rect(4, 5, 8, 2, C.dark);
    // Housing: a bevelled box. The lens is inset by one on every side so the
    // lit state glows out of a frame instead of becoming a coloured square.
    c.panel(2, 10, 12, 10, C.dark, C.graphite);
    c.rect(4, 12, 8, 6, on ? C.coral : C.ledOff);
    if (on) {
      c.rect(5, 13, 6, 3, C.whiteLit); // hot core
      c.rect(4, 12, 8, 1, C.coralDim);
      // A one-pixel halo hugging the housing, and nothing else. A dithered
      // cone of light under the box read unmistakably as a basketball hoop --
      // do not put a spill cone back.
      c.rect(1, 9, 14, 1, C.coralDim);
      c.rect(1, 20, 14, 1, C.coralDim);
      c.rect(1, 10, 1, 10, C.coralDim);
      c.rect(14, 10, 1, 10, C.coralDim);
    } else {
      c.rect(5, 13, 6, 2, C.graphiteLit); // dead glass still catches light
    }
    return c;
  };
  emitStates('MEETING_LIGHT', 'Meeting Light', { off: build(false), on: build(true) }, 1, 2, {
    category: 'wall',
    canPlaceOnWalls: true,
  });
}

// ── Coat rack: they walk to lunch, so the coats come off ──────
{
  const c = new Canvas(16, 32);
  c.rect(7, 4, 2, 24, C.dark); // pole
  c.rect(6, 3, 4, 1, C.dark); // finial
  for (const [x, y] of [
    [5, 7],
    [10, 7],
  ]) {
    c.rect(x, y, 1, 2, C.dark); // hooks, dropping off the pole head
  }
  /**
   * A coat is three things at this size: a narrow shoulder, a body one pixel
   * wider, and a hem wider again. Drawn as explicit spans rather than a
   * flare calculation -- the calculation was a pixel out at both ends and the
   * coats came out as vertical bars.
   */
  const coat = (rows, body, shade) => {
    c.spans(rows, body);
    for (const [y, x0, x1] of rows) {
      c.set(x0, y, C.dark); // outline both edges, or it melts into the wall
      c.set(x1, y, shade);
    }
  };
  coat(
    [
      [9, 2, 5],
      [10, 1, 5],
      [11, 0, 5],
      [12, 0, 5],
      [13, 0, 5],
      [14, 0, 5],
      [15, 0, 5],
      [16, 0, 5],
      [17, 0, 5],
      [18, 0, 5],
      [19, 1, 4],
    ],
    C.coatCold,
    C.denimDim,
  );
  coat(
    [
      [9, 10, 13],
      [10, 10, 14],
      [11, 10, 15],
      [12, 10, 15],
      [13, 10, 15],
      [14, 10, 15],
      [15, 10, 15],
      [16, 10, 15],
      [17, 10, 15],
      [18, 11, 14],
    ],
    C.coatWarm,
    C.coatWarmDim,
  );
  // A coral scarf looped over the pole between the two coats: the one brand
  // colour on the piece, and what stops the pair reading as one dark lump.
  // Kept to a loop and two short tails -- a full-length scarf outweighed both
  // coats and the rack turned into a scarf on a stick.
  c.rect(6, 8, 4, 1, C.coral);
  c.rect(6, 9, 1, 4, C.coral);
  c.rect(9, 9, 1, 3, C.coralDim);
  c.set(6, 13, C.coralDim);
  // Splayed feet. A rack on a single stalk looks like it is about to fall over.
  c.spans(
    [
      [28, 3, 12],
      [29, 2, 13],
      [30, 4, 11],
    ],
    C.dark,
  );
  c.rect(3, 31, 10, 1, C.underShadow);
  emit('COAT_RACK', 'Coat Rack', c, 1, 2, { category: 'decor', backgroundTiles: 1 });
}

// ── Water cooler ──────────────────────────────────────────────
{
  const c = new Canvas(16, 32);
  // Inverted bottle: a tapered neck at the bottom is the whole read. A plain
  // blue box on a white box would be a vending machine.
  c.spans(
    [
      [3, 4, 11],
      [4, 3, 12],
    ],
    C.dark,
  );
  c.rect(3, 5, 10, 6, C.water);
  c.rect(4, 5, 3, 6, C.waterLit); // the highlight that makes it glass
  c.spans(
    [
      [11, 4, 11],
      [12, 5, 10],
      [13, 6, 9],
    ],
    C.water,
  );
  c.rect(3, 5, 1, 6, C.dark);
  c.rect(12, 5, 1, 6, C.dark);
  // Body.
  c.panel(2, 13, 12, 17, C.dark, C.steelLit);
  c.rect(3, 14, 4, 15, C.whiteLit);
  c.rect(11, 14, 2, 15, C.steel);
  // Two taps, blue and red, because that is what every cooler has and it is the
  // only detail that dates this as a cooler and not a filing cabinet.
  c.rect(4, 18, 3, 2, C.water);
  c.rect(9, 18, 3, 2, C.coralDim);
  c.rect(5, 20, 1, 2, C.steelDim);
  c.rect(10, 20, 1, 2, C.steelDim);
  // Drip tray: a dark grille under the taps.
  c.rect(4, 24, 8, 3, C.graphite);
  for (const x of [5, 7, 9]) c.rect(x, 25, 1, 1, C.steelDim);
  c.rect(3, 30, 10, 1, C.underShadow);
  emit('WATER_COOLER', 'Water Cooler', c, 1, 2, { category: 'misc', backgroundTiles: 1 });
}

// ── A proper bean-to-cup coffee machine ───────────────────────
{
  const build = (on) => {
    const c = new Canvas(16, 32);
    // Bean hopper on top, angled: the lid is what says "beans" rather than
    // "microwave", and it costs three rows.
    c.spans(
      [
        [4, 5, 11],
        [5, 4, 12],
      ],
      C.dark,
    );
    c.rect(5, 6, 6, 2, C.kraft);
    c.panel(2, 8, 12, 22, C.darker, C.graphite);
    // Display.
    c.rect(4, 10, 8, 5, C.darker);
    c.rect(5, 11, 6, 3, on ? C.paleMint : C.graphiteLit);
    if (on) {
      c.rect(5, 11, 6, 1, C.mint);
      c.rect(6, 13, 3, 1, C.mint);
    }
    // Group head and the two spouts.
    c.rect(5, 16, 6, 2, C.steelDim);
    c.rect(6, 18, 1, 2, C.steel);
    c.rect(9, 18, 1, 2, C.steel);
    // One cup on the tray, tapered and with a handle. A full-width white block
    // here read as a drawer, not as something you drink out of.
    c.spans(
      [
        [22, 6, 9],
        [23, 6, 9],
        [24, 7, 8],
      ],
      C.paper,
    );
    c.rect(6, 21, 4, 1, C.whiteLit); // rim
    c.set(10, 22, C.steel); // handle
    // No steam: pixels floating either side of the group head read as wings,
    // and there is no clear air above the cup to put a plume in. The filled
    // cup and the lit display carry the on state instead.
    if (on) c.rect(6, 22, 4, 2, C.kraft);
    c.rect(4, 25, 8, 2, C.darker); // drip tray
    c.rect(3, 27, 10, 2, C.graphiteLit);
    c.rect(4, 9, 1, 1, on ? C.coral : C.ledOff); // power light
    c.rect(3, 30, 10, 1, C.underShadow);
    return c;
  };
  emitStates('COFFEE_MACHINE', 'Coffee Machine', { off: build(false), on: build(true) }, 1, 2, {
    backgroundTiles: 1,
  });
}

// ── Server rack, for the corner nobody decorates ──────────────
{
  const build = (on) => {
    const c = new Canvas(16, 32);
    c.panel(1, 2, 14, 28, C.darker, C.graphite);
    // Five 1U servers. The stack of identical slots is the entire read -- a
    // rack is a repeating rhythm, and breaking it up would only lose that.
    for (let i = 0; i < 5; i++) {
      const y = 5 + i * 5;
      c.rect(3, y, 10, 4, C.graphiteLit);
      c.rect(3, y + 3, 10, 1, C.darker);
      // Vent slots on the left of each unit, LEDs on the right.
      for (const x of [4, 5, 6, 7]) c.rect(x, y + 1, 1, 2, C.darker);
      c.set(11, y + 1, on ? (i % 2 ? C.mint : C.coral) : C.ledOff);
      c.set(11, y + 2, on && i !== 2 ? C.ledAmber : C.ledOff);
    }
    // Glass door hinge line, so the front reads as a door and not a shelf.
    c.rect(2, 3, 1, 26, C.steelDim);
    c.rect(13, 15, 1, 3, C.steel); // handle
    c.rect(2, 30, 12, 1, C.underShadow);
    return c;
  };
  emitStates('SERVER_RACK', 'Server Rack', { off: build(false), on: build(true) }, 1, 2, {
    backgroundTiles: 1,
  });
}

// ── Flip chart on a tripod easel ──────────────────────────────
{
  const c = new Canvas(32, 32);
  // Back leg first: it has to be overdrawn by the pad, otherwise the easel
  // reads as standing in front of its own paper.
  c.rect(15, 6, 2, 22, C.corkDim);
  c.panel(4, 2, 24, 21, C.dark, C.paper);
  c.rect(5, 3, 22, 2, C.steelLit); // the aluminium clamp along the top
  for (const x of [9, 15, 21]) c.rect(x, 3, 1, 2, C.steelDim);
  // A sprint board, drawn as a coral heading plus mint ticks. Real text here
  // would be 3px tall inside a 20px sheet and would smear.
  c.rect(7, 8, 12, 2, C.coral);
  for (const y of [12, 15, 18]) {
    c.rect(7, y, 2, 2, C.mint);
    c.rect(11, y, 11, 1, C.muted);
  }
  // A dog-eared bottom corner: the sheet has been flipped before.
  c.set(26, 22, C.corkDim);
  c.set(25, 22, C.steel);
  // Front legs, splayed, plus the pen tray they hang off.
  c.rect(5, 23, 22, 2, C.corkDim);
  c.rect(8, 22, 3, 1, C.coral); // a marker left in the tray
  c.spans(
    [
      [25, 6, 8],
      [26, 5, 7],
      [27, 4, 6],
      [28, 4, 5],
      [25, 23, 25],
      [26, 24, 26],
      [27, 25, 27],
      [28, 26, 27],
    ],
    C.dark,
  );
  c.rect(4, 29, 24, 1, C.underShadow);
  emit('FLIPCHART', 'Flip Chart', c, 2, 2, { category: 'misc', backgroundTiles: 1 });
}

// ── Lounge beanbag ────────────────────────────────────────────
{
  const c = new Canvas(32, 32);
  // A pear, not a dome. The first attempt was a 32x16 lens and read as a UFO:
  // a beanbag needs a tall slumped crown over a wide base, and the crown has
  // to sit off-centre or the whole thing looks inflated rather than sat in.
  const body = [
    [7, 11, 17],
    [8, 9, 19],
    [9, 8, 21],
    [10, 7, 22],
    [11, 6, 23],
    [12, 5, 24],
    [13, 4, 25],
    [14, 4, 26],
    [15, 3, 27],
    [16, 3, 27],
    [17, 2, 28],
    [18, 2, 28],
    [19, 1, 29],
    [20, 1, 29],
    [21, 1, 30],
    [22, 1, 30],
    [23, 1, 30],
    [24, 2, 29],
    [25, 3, 28],
    [26, 5, 26],
    [27, 8, 23],
  ];
  c.spans(body, C.denim);
  for (const [y, x0, x1] of body) {
    c.set(x0, y, C.denimDim); // outline both edges, or it melts into the floor
    c.set(x1, y, C.denimDim);
  }
  c.spans(
    [
      [6, 12, 16],
      [28, 11, 20],
    ],
    C.denimDim,
  );
  // The lit shoulder, upper left, and the dent where the last person sat.
  c.spans(
    [
      [9, 10, 15],
      [10, 9, 14],
      [11, 8, 13],
      [12, 7, 12],
      [13, 6, 11],
    ],
    C.denimLit,
  );
  c.spans(
    [
      [7, 12, 16],
      [8, 13, 17],
    ],
    C.denimDim,
  );
  // The seam round the waist is what makes this a stitched bag rather than a
  // blob, and the grab handle is the detail everyone recognises.
  c.spans(
    [
      [19, 3, 12],
      [18, 13, 19],
      [19, 20, 27],
    ],
    C.denimDim,
  );
  c.rect(23, 11, 4, 1, C.denimDim);
  c.rect(22, 12, 1, 1, C.denimDim);
  c.rect(27, 12, 1, 1, C.denimDim);
  c.rect(6, 29, 20, 1, C.underShadow);
  emit('BEANBAG', 'Beanbag', c, 2, 2, { category: 'chairs', backgroundTiles: 1 });
}

// ── Bakery bag from the ochtendbroodjes run ───────────────────
{
  const c = new Canvas(16, 16);
  // A stroopwafel standing in the mouth of the bag, drawn first so the bag
  // overlaps its bottom edge and it reads as inside rather than balanced on
  // top. Offset right, clear of the fold, or the two shapes merge.
  c.spans(
    [
      [1, 8, 12],
      [2, 7, 13],
      [3, 7, 13],
      [4, 8, 12],
    ],
    C.kraftLit,
  );
  c.rect(7, 2, 7, 1, C.corkDim); // the syrup seam through the middle
  // Bag: one outlined block. The earlier serrated mouth turned into a comb --
  // three notches in a solid fold is as much "torn open" as 16px will carry.
  c.rect(2, 4, 12, 12, C.dark);
  c.rect(3, 5, 10, 10, C.kraft);
  c.rect(3, 5, 10, 2, C.kraftLit); // the rolled-over top fold
  // Notches in the fold, soft rather than black: cut with the outline colour
  // they turned the top of the bag into castle crenellations.
  for (const x of [5, 8, 11]) c.set(x, 5, C.corkDim);
  c.rect(3, 7, 2, 8, C.kraftLit); // the lit gusset
  c.rect(9, 7, 1, 8, C.corkDim); // the shaded one
  // Coral band: the bakery's own printing, and the file's brand colour.
  c.rect(4, 9, 8, 2, C.coral);
  c.rect(5, 12, 6, 1, C.corkDim);
  emit('BAKERY_BAG', 'Bakery Bag', c, 1, 1, { category: 'misc', canPlaceOnSurfaces: true });
}

// ── Ping-pong table for the lounge ────────────────────────────
{
  const c = new Canvas(48, 48);
  // Drawn as a top plane with a shallow front edge and legs, matching the
  // bundled TABLE_FRONT so it stands on the same ground as the other tables.
  c.rect(1, 2, 46, 36, C.feltDim);
  c.rect(2, 3, 44, 34, C.felt);
  // Court markings. The white border and the centre line are the only things
  // that make this green rectangle a table-tennis table.
  c.rect(4, 5, 40, 1, C.paper);
  c.rect(4, 34, 40, 1, C.paper);
  c.rect(4, 5, 1, 30, C.paper);
  c.rect(43, 5, 1, 30, C.paper);
  c.rect(23, 5, 1, 30, C.paper);
  // Net across the middle, with posts overhanging both edges.
  c.rect(1, 18, 46, 1, C.steelDim);
  c.rect(1, 19, 46, 2, C.steelLit);
  c.rect(1, 21, 46, 1, C.steelDim);
  for (let x = 2; x < 46; x += 3) c.rect(x, 19, 1, 2, C.steel);
  c.rect(0, 17, 2, 6, C.graphite);
  c.rect(46, 17, 2, 6, C.graphite);
  // Front edge and legs.
  c.rect(1, 38, 46, 3, C.feltDim);
  c.rect(1, 41, 46, 1, C.darker);
  c.rect(3, 42, 4, 4, C.graphite);
  c.rect(41, 42, 4, 4, C.graphite);
  c.rect(7, 43, 34, 2, C.underShadow);
  // A bat and a ball left on the table: the prop is only fun if it looks used.
  // The bat head is spanned rather than a rect -- a square head reads as a
  // sticky note lying on the table.
  c.spans(
    [
      [25, 32, 36],
      [26, 31, 37],
      [27, 30, 38],
      [28, 30, 38],
      [29, 30, 38],
      [30, 31, 37],
      [31, 32, 36],
    ],
    C.coral,
  );
  c.spans(
    [
      [27, 32, 36],
      [28, 32, 36],
      [29, 32, 36],
    ],
    C.coralDim,
  );
  c.rect(33, 31, 3, 5, C.dark);
  c.rect(14, 11, 2, 2, C.whiteLit);
  emit('PINGPONG_TABLE', 'Ping-Pong Table', c, 3, 3, { category: 'desks', backgroundTiles: 1 });
}

// ── Toilet ────────────────────────────────────────────────────
{
  const c = new Canvas(16, 32);
  // Cistern first: it is the silhouette that says "toilet" before any of the
  // porcelain below resolves. Outlined, because a white box on a pale floor is
  // otherwise nothing at all.
  c.panel(3, 4, 10, 10, C.dark, C.porcelain);
  c.rect(4, 10, 8, 3, C.porcelainShade); // the shaded lower half of the tank
  c.rect(6, 6, 4, 2, C.porcelainDim); // flush plate
  c.rect(7, 6, 2, 1, C.steelDim);
  c.rect(6, 14, 4, 2, C.porcelainShade); // the neck joining tank to pan
  // Lid down would be a plain white oval and read as a stool. Up, the seat ring
  // frames a dark opening, and that opening is the whole read -- the first pass
  // made it four pixels wide and the sprite came out as a chess pawn.
  const ring = [
    [16, 4, 11],
    [17, 3, 12],
    [18, 2, 13],
    [19, 2, 13],
    [20, 2, 13],
    [21, 3, 12],
    [22, 4, 11],
  ];
  c.spans(ring, C.porcelain);
  for (const [y, x0, x1] of ring) {
    c.set(x0, y, C.dark);
    c.set(x1, y, C.dark);
  }
  c.rect(6, 15, 4, 1, C.dark);
  c.rect(5, 23, 6, 1, C.dark);
  // Oval, not a rectangle: three full-width rows made the opening read as a
  // letterbox slot cut in the seat.
  c.spans(
    [
      [17, 6, 9],
      [18, 5, 10],
      [19, 4, 11],
      [20, 5, 10],
      [21, 6, 9],
    ],
    C.bowlDark,
  );
  c.rect(5, 19, 6, 1, C.glassDim); // water in the pan, catching the light
  // Pedestal: clearly narrower than the ring, so the widest part of the sprite
  // is the seat rather than the base.
  c.spans(
    [
      [23, 5, 10],
      [24, 5, 10],
      [25, 5, 10],
      [26, 4, 11],
      [27, 4, 11],
      [28, 3, 12],
    ],
    C.porcelain,
  );
  for (const [y, x0, x1] of [
    [23, 5, 10],
    [24, 5, 10],
    [25, 5, 10],
    [26, 4, 11],
    [27, 4, 11],
    [28, 3, 12],
  ]) {
    c.set(x0, y, C.dark);
    c.set(x1, y, C.porcelainDim);
  }
  c.rect(9, 24, 1, 5, C.porcelainShade);
  c.rect(3, 29, 10, 1, C.dark);
  c.rect(3, 30, 10, 1, C.underShadow);
  // ── Back and side views, so the thing can be turned ──────────
  // A lone asset cannot rotate: R looks the type up in a rotation group, finds
  // none and does nothing. A fixture you cannot face into a corner is not much
  // use in a washroom.

  /** From behind: the cistern is nearest the viewer and hides most of the pan.
   *  Only the far lip of the seat shows above it -- drawing the whole ring back
   *  there produced a second seat floating over the tank. */
  const back = new Canvas(16, 32);
  {
    const b = back;
    const lip = [
      [5, 4, 11],
      [6, 3, 12],
      [7, 3, 12],
    ];
    b.spans(lip, C.porcelain);
    for (const [y, x0, x1] of lip) {
      b.set(x0, y, C.dark);
      b.set(x1, y, C.dark);
    }
    b.rect(3, 8, 10, 1, C.dark);
    // The tank, taller from this side because nothing is in front of it.
    b.panel(2, 9, 12, 14, C.dark, C.porcelain);
    b.rect(3, 17, 10, 5, C.porcelainShade);
    b.rect(6, 12, 4, 2, C.porcelainDim); // the flush plate, seen square on
    b.rect(7, 12, 2, 1, C.steelDim);
    b.rect(4, 23, 8, 5, C.porcelain);
    b.rect(4, 23, 1, 5, C.dark);
    b.rect(11, 23, 1, 5, C.porcelainDim);
    b.rect(3, 28, 10, 1, C.dark);
    b.rect(3, 29, 10, 1, C.underShadow);
  }

  /** In profile the L is the whole read, and the first attempt did not have
   *  one: a narrow tank floating ABOVE the seat made a sprite indistinguishable
   *  from the washbasin standing next to it. The tank has to be a tall mass
   *  BESIDE the seat, reaching down to it, with the seat cantilevered out. */
  const side = new Canvas(16, 32);
  {
    const d = side;
    // Cistern: tall, and it comes all the way down to seat height.
    d.panel(2, 6, 6, 15, C.dark, C.porcelain);
    d.rect(3, 15, 4, 5, C.porcelainShade);
    d.rect(4, 8, 2, 2, C.porcelainDim); // flush plate on the top face
    d.set(5, 8, C.steelDim);

    // Seat, cantilevered away from the tank at a single clear height.
    d.rect(7, 14, 7, 2, C.porcelain);
    d.rect(7, 14, 7, 1, C.whiteLit);
    d.rect(7, 16, 7, 1, C.dark);
    d.set(13, 15, C.dark); // the far lip, so the seat has an end

    // Bowl hanging under the seat, tapering as it drops.
    d.spans(
      [
        [17, 8, 13],
        [18, 8, 13],
        [19, 8, 12],
        [20, 9, 12],
      ],
      C.porcelain,
    );
    for (const [y, x0, x1] of [
      [17, 8, 13],
      [18, 8, 13],
      [19, 8, 12],
      [20, 9, 12],
    ]) {
      d.set(x0, y, C.dark);
      d.set(x1, y, C.porcelainDim);
    }
    d.rect(9, 17, 3, 1, C.bowlDark); // opening, glimpsed under the rim

    // Foot: under the bowl, not under the tank, which is what stops the whole
    // thing reading as a pedestal basin.
    d.rect(9, 21, 4, 7, C.porcelain);
    d.rect(9, 21, 1, 7, C.dark);
    d.rect(12, 21, 1, 7, C.porcelainDim);
    d.rect(3, 21, 4, 7, C.porcelain); // the tank's own base beside it
    d.rect(3, 21, 1, 7, C.dark);
    d.rect(6, 21, 1, 7, C.porcelainDim);
    d.rect(2, 28, 12, 1, C.dark);
    d.rect(2, 29, 12, 1, C.underShadow);
  }

  emitRotation('TOILET', 'Toilet', { front: c, back, side }, 1, 2, {
    category: 'misc',
    backgroundTiles: 1,
  });
}

// ── Washbasin ─────────────────────────────────────────────────
{
  const c = new Canvas(16, 32);
  // A pedestal basin rather than the wall-hung one: wall-hung leaves the bottom
  // tile empty, and a bowl floating in mid-air reads as a bath tub. The tap and
  // the drain are the two details doing the work -- without them this is a
  // white lump, which is exactly the failure mode to avoid here.
  // Slim riser with a gooseneck reaching over the bowl. A 4px-wide block of
  // steel here read as a monolith standing on the rim.
  c.rect(8, 7, 2, 5, C.steelDim); // pillar
  c.rect(8, 6, 2, 1, C.steel);
  c.rect(5, 8, 3, 1, C.steel); // spout jutting out over the bowl
  c.set(5, 9, C.steelLit); // the mouth, one pixel of highlight
  c.rect(3, 10, 2, 1, C.water); // cold and hot handles, out on the rim
  c.rect(11, 10, 2, 1, C.coralDim);
  c.rect(5, 11, 6, 1, C.porcelainDim); // the back ledge they are mounted on
  const bowl = [
    [13, 3, 12],
    [14, 2, 13],
    [15, 2, 13],
    [16, 2, 13],
    [17, 3, 12],
    [18, 4, 11],
    [19, 6, 9],
  ];
  c.spans(bowl, C.porcelain);
  for (const [y, x0, x1] of bowl) {
    c.set(x0, y, C.dark);
    c.set(x1, y, C.dark);
  }
  c.rect(3, 12, 10, 1, C.dark); // rim
  // The inside of the bowl, shaded, with the plughole at the bottom of it.
  c.spans(
    [
      [14, 4, 11],
      [15, 4, 11],
      [16, 5, 10],
    ],
    C.porcelainShade,
  );
  c.rect(7, 16, 2, 1, C.bowlDark);
  c.rect(4, 14, 3, 1, C.glassLit); // a wet highlight on the porcelain
  // Pedestal, and the shadow gap where it meets the underside of the bowl.
  c.rect(6, 19, 4, 9, C.porcelain);
  c.rect(6, 19, 1, 9, C.dark);
  c.rect(9, 19, 1, 9, C.porcelainDim);
  c.spans(
    [
      [28, 4, 11],
      [29, 3, 12],
    ],
    C.porcelain,
  );
  c.rect(3, 29, 1, 1, C.dark);
  c.rect(12, 29, 1, 1, C.dark);
  c.rect(4, 30, 8, 1, C.underShadow);
  emit('WASHBASIN', 'Washbasin', c, 1, 2, { category: 'misc', backgroundTiles: 1 });
}

// ── Mirror ────────────────────────────────────────────────────
{
  const c = new Canvas(16, 32);
  // A mirror is a frame around something that is not the wall. No attempt at a
  // reflection: at 12px across, anything reflected is a smudge, and a smudge in
  // a frame reads as a dirty painting. Cool flat glass plus a streak is the
  // whole trick.
  c.panel(2, 3, 12, 26, C.dark, C.dark);
  c.rect(4, 5, 8, 22, C.glass); // a 2px frame, matching the other wall pieces
  c.rect(4, 5, 8, 1, C.glassDim); // the frame's own shadow on the glass
  c.rect(4, 5, 1, 22, C.glassDim);
  // Two diagonal streaks, wide and narrow. One alone reads as a crack; the
  // paired offset is what everybody draws when they draw glass.
  for (let i = 0; i < 7; i++) {
    c.rect(5 + i, 19 - i, 2, 1, C.glassLit);
  }
  for (let i = 0; i < 4; i++) {
    c.set(5 + i, 25 - i, C.glassLit);
  }
  c.rect(5, 3, 6, 1, C.steelLit); // a bright top edge, so it hangs off the wall
  emit('MIRROR', 'Mirror', c, 1, 2);
}

/**
 * The shared body of a kitchen counter, so the plain run and the sink unit are
 * literally the same shell and cannot drift apart.
 *
 * Tiling is the whole design constraint here. Every horizontal band runs the
 * full 32px with no left or right outline, so two counters butt together
 * without a doubled edge or a seam; all the detail is per-16px-tile, which
 * means the door rhythm continues across the join instead of restarting. The
 * cost is that a single counter has no end cap -- accepted deliberately, since
 * a kitchen is a run and a run with hard ends cannot be extended.
 */
function counterShell(c) {
  c.rect(0, 1, 32, 1, C.dark);
  c.rect(0, 2, 32, 2, C.oakLit); // the back of the worktop catches the light
  c.rect(0, 4, 32, 11, C.oak);
  // Grain, sparse and horizontal. Anything denser turns the worktop into noise
  // once a kettle and a toaster are standing on it.
  for (const [x, y, w] of [
    [3, 7, 7],
    [18, 6, 9],
    [11, 11, 6],
    [23, 12, 6],
    [2, 13, 5],
  ]) {
    c.rect(x, y, w, 1, C.oakDim);
  }
  c.rect(0, 15, 32, 2, C.oakDim); // the front edge of the slab
  c.rect(0, 17, 32, 1, C.dark); // its shadow on the cupboard fronts
  c.rect(0, 18, 32, 12, C.porcelainShade);
  for (const t of [0, 1]) {
    const x = t * 16 + 2;
    c.rect(x, 19, 12, 10, C.dark);
    c.rect(x + 1, 20, 10, 8, C.porcelain);
    c.rect(x + 1, 26, 10, 2, C.porcelainShade);
    // Handles meet at the middle of each pair, which is how a two-door unit
    // actually looks -- and it keeps the rhythm symmetrical across a join.
    c.rect(t === 0 ? x + 9 : x + 2, 22, 1, 4, C.steelDim);
  }
  c.rect(0, 30, 32, 1, C.dark); // recessed plinth
  c.rect(0, 31, 32, 1, C.underShadow);
}

// ── Kitchen counter ───────────────────────────────────────────
{
  const c = new Canvas(32, 32);
  counterShell(c);
  // Category 'desks' is not a mistake: the engine derives isDesk from it, and
  // isDesk is what lets a canPlaceOnSurfaces prop stand on top of something.
  // A counter you cannot put the kettle on is a cupboard.
  emit('KITCHEN_COUNTER', 'Kitchen Counter', c, 2, 2, {
    category: 'desks',
    backgroundTiles: 1,
  });
}

// ── Kitchen counter with a sink ───────────────────────────────
{
  const c = new Canvas(32, 32);
  counterShell(c);
  // Worth its own asset next to WASHBASIN: that one is a pedestal basin stood
  // on the floor of the washroom, seen face on. This is a bowl dropped into a
  // worktop, seen from above, and it has to keep the counter's tiling edges.
  // Nothing about the two sprites overlaps.
  c.rect(5, 4, 22, 11, C.dark);
  c.rect(6, 5, 20, 9, C.steel);
  c.rect(6, 5, 20, 2, C.steelLit); // the near-vertical back wall of the bowl
  c.rect(7, 10, 18, 3, C.steelDim); // and the shaded floor of it
  c.rect(14, 9, 3, 2, C.bowlDark); // plughole
  c.rect(15, 11, 1, 2, C.steelDim);
  // Mixer tap, seen from behind: a pillar at the back edge with the spout
  // reaching out over the bowl.
  c.rect(15, 1, 2, 3, C.steelDim);
  c.rect(12, 2, 4, 1, C.steel);
  c.set(12, 3, C.steelLit);
  // No draining grooves cut into the oak: dashes in the worktop are exactly
  // what the wood grain already is, and the two were indistinguishable.
  // The bowl runs wider instead, which is what a drainer-side sink looks like.
  c.rect(20, 6, 5, 7, C.steelLit);
  c.rect(20, 6, 5, 1, C.steel);
  for (const y of [8, 10, 12]) c.rect(20, y, 5, 1, C.steel);
  emit('KITCHEN_SINK', 'Kitchen Sink Counter', c, 2, 2, {
    category: 'desks',
    backgroundTiles: 1,
  });
}

// ── Fridge ────────────────────────────────────────────────────
{
  const c = new Canvas(16, 32);
  c.rect(1, 2, 14, 28, C.dark);
  c.rect(2, 3, 12, 26, C.porcelain);
  c.rect(12, 3, 2, 26, C.porcelainShade); // the rounded right-hand side
  c.rect(2, 11, 12, 1, C.dark); // freezer over fridge
  c.rect(2, 12, 12, 1, C.porcelainDim);
  c.rect(11, 6, 1, 4, C.steelDim); // handles, both doors
  c.rect(11, 15, 1, 9, C.steelDim);
  // No on/off pair: a fridge that lights up would need its door open, and an
  // open door is a different silhouette, not a state. Magnets carry the
  // personality instead -- a bare white slab reads as a server cabinet.
  c.rect(3, 5, 5, 5, C.paper); // a note held up by two of them
  for (const [x, y] of [
    [4, 6],
    [4, 8],
    [6, 7],
  ]) {
    c.rect(x, y, 2, 1, C.muted);
  }
  c.set(3, 5, C.coral);
  c.set(7, 9, C.mint);
  c.rect(4, 15, 2, 2, C.coral);
  c.rect(8, 18, 2, 2, C.mint);
  c.rect(3, 22, 3, 1, C.coralDim);
  c.rect(2, 30, 12, 1, C.underShadow);
  emit('FRIDGE', 'Fridge', c, 1, 2, { category: 'storage', backgroundTiles: 1 });
}

// ── Smart fridge ──────────────────────────────────────────────
// The one with a screen in the door. Named for what it is rather than after a
// manufacturer: the sprite is a generic appliance and a brand name on it would
// be a claim nobody needs.
//
// An on/off pair, unlike the plain FRIDGE. The reasoning that ruled it out
// there does not apply here: lighting a normal fridge means opening its door,
// which is a different silhouette, but a screen going dark is exactly what a
// state change looks like.
{
  const build = (lit) => {
    const c = new Canvas(16, 32);
    // Darker body than the white FRIDGE, so the two are not the same sprite in
    // two moods -- this one reads as stainless.
    c.rect(1, 2, 14, 28, C.darker);
    c.rect(2, 3, 12, 26, C.steel);
    c.rect(12, 3, 2, 26, C.steelDim); // the rounded right-hand side
    // French doors: a vertical seam rather than the freezer-over-fridge
    // horizontal one, which is what distinguishes the shape at a glance.
    c.rect(7, 3, 1, 26, C.darker);
    c.rect(8, 3, 1, 26, C.steelLit);
    c.rect(6, 8, 1, 8, C.graphite); // handles, one per door
    c.rect(9, 8, 1, 8, C.graphite);

    // The screen fills most of the left door. Bezel first, so it reads as a
    // panel set INTO the door rather than a sticker on it.
    c.rect(2, 5, 5, 13, C.darker);
    if (lit) {
      c.rect(3, 6, 3, 11, C.paleMint);
      // A shopping list and a photo: the two things anybody actually puts on
      // one of these. Coral for the accent row, as everywhere else.
      c.rect(3, 6, 3, 2, C.coral);
      for (const y of [9, 11, 13]) c.rect(3, y, 3, 1, C.mint);
      c.rect(3, 15, 2, 2, C.mint);
      c.set(5, 16, C.coralDim);
    } else {
      c.rect(3, 6, 3, 11, C.graphite);
      c.rect(3, 6, 3, 1, C.graphiteLit); // one sheen row: off, not a hole
    }
    // Water and ice dispenser recessed into the right door, which is the other
    // thing that says "this is the expensive one".
    c.rect(10, 19, 3, 5, C.darker);
    c.rect(11, 20, 1, 3, C.graphiteLit);
    if (lit) c.set(12, 20, C.coral);
    c.rect(2, 30, 12, 1, C.underShadow);
    return c;
  };
  emitStates('SMART_FRIDGE', 'Smart Fridge', { off: build(false), on: build(true) }, 1, 2, {
    category: 'electronics',
    backgroundTiles: 1,
  });
}

// ── Overhead cupboards ────────────────────────────────────────
{
  const c = new Canvas(32, 32);
  // Same per-tile door rhythm and the same edgeless sides as the counter, so a
  // run of cupboards tiles and lines up with the run of counters beneath it.
  c.rect(0, 2, 32, 1, C.dark);
  c.rect(0, 3, 32, 22, C.porcelainShade);
  for (const t of [0, 1]) {
    const x = t * 16 + 2;
    c.rect(x, 4, 12, 18, C.dark);
    c.rect(x + 1, 5, 10, 16, C.porcelain);
    c.rect(x + 1, 17, 10, 4, C.porcelainShade);
    // Handles along the bottom edge: that is where they are on a wall unit,
    // and it stops the pair reading as two blank doors.
    c.rect(x + 3, 19, 6, 1, C.steelDim);
  }
  c.rect(0, 25, 32, 1, C.oakDim); // the underside, seen from below
  c.rect(0, 26, 32, 1, C.dark);
  emit('WALL_CUPBOARDS', 'Overhead Cupboards', c, 2, 2);
}

// ── Microwave ─────────────────────────────────────────────────
{
  const c = new Canvas(16, 16);
  c.rect(0, 4, 16, 11, C.dark);
  c.rect(1, 5, 14, 9, C.graphite);
  c.rect(1, 5, 14, 1, C.graphiteLit);
  // Door window, with the mesh dotted in. A plain dark rectangle reads as a
  // drawer; the mesh and the pale interior are what make it a window.
  c.rect(2, 6, 8, 7, C.bowlDark);
  c.rect(3, 7, 6, 5, C.graphiteLit);
  for (let y = 7; y < 12; y++) {
    for (let x = 3; x < 9; x++) if ((x + y) % 2 === 0) c.set(x, y, C.graphite);
  }
  c.rect(10, 7, 1, 5, C.steelLit); // handle
  // Keypad and a display line.
  c.rect(12, 7, 3, 1, C.paleMint);
  for (const y of [9, 11]) {
    for (const x of [12, 14]) c.set(x, y, C.steelDim);
  }
  c.set(13, 10, C.coralDim);
  c.set(1, 15, C.darker);
  c.set(14, 15, C.darker);
  emit('MICROWAVE', 'Microwave', c, 1, 1, {
    category: 'electronics',
    canPlaceOnSurfaces: true,
  });
}

// ── Kettle ────────────────────────────────────────────────────
{
  const c = new Canvas(16, 16);
  const body = [
    [5, 5, 10],
    [6, 4, 11],
    [7, 4, 11],
    [8, 4, 11],
    [9, 4, 11],
    [10, 4, 11],
    [11, 4, 11],
    [12, 5, 10],
  ];
  c.spans(body, C.steelLit);
  for (const [y, x0, x1] of body) {
    c.set(x0, y, C.dark);
    c.set(x1, y, C.steel);
  }
  c.rect(5, 4, 6, 1, C.steelDim); // lid
  c.rect(7, 3, 2, 1, C.dark); // and its knob
  // Spout and handle on opposite sides: the pair is the silhouette. Without
  // both, a tapered steel drum is a bin.
  c.spans(
    [
      [5, 2, 3],
      [6, 1, 3],
      [7, 1, 3],
      [8, 2, 3],
    ],
    C.steel,
  );
  c.set(1, 5, C.steelLit); // the lip of the spout
  c.rect(12, 6, 2, 1, C.dark);
  c.rect(13, 7, 1, 4, C.dark);
  c.rect(12, 11, 2, 1, C.dark);
  c.rect(6, 8, 2, 3, C.glass); // water window
  // The base in steelDim, not graphite: a near-black base vanished into the
  // floor and left the power light floating under the kettle on its own.
  c.rect(4, 13, 8, 2, C.steelDim);
  c.rect(4, 15, 8, 1, C.dark);
  c.set(8, 14, C.coral);
  emit('KETTLE', 'Kettle', c, 1, 1, { category: 'misc', canPlaceOnSurfaces: true });
}

// ── Toaster ───────────────────────────────────────────────────
{
  const c = new Canvas(16, 16);
  // Two slices standing proud of the slots, drawn first so the body overlaps
  // their bottoms. The bread is what tells a chrome box from a radio.
  for (const x of [3, 9]) {
    c.rect(x, 2, 4, 4, C.kraftLit);
    c.rect(x, 2, 4, 1, C.kraft);
    c.rect(x + 1, 3, 2, 2, C.kraft);
  }
  c.rect(1, 5, 14, 2, C.steel);
  c.rect(3, 5, 4, 1, C.darker); // the slots
  c.rect(9, 5, 4, 1, C.darker);
  c.rect(1, 7, 14, 7, C.dark);
  c.rect(2, 8, 12, 5, C.steelLit);
  c.rect(2, 11, 12, 2, C.steel);
  c.rect(14, 8, 1, 3, C.dark); // lever
  c.set(15, 8, C.dark);
  c.set(3, 11, C.coralDim); // browning dial
  c.set(2, 14, C.darker);
  c.set(13, 14, C.darker);
  emit('TOASTER', 'Toaster', c, 1, 1, { category: 'misc', canPlaceOnSurfaces: true });
}

// ── Dish rack ─────────────────────────────────────────────────
{
  const c = new Canvas(16, 16);
  // Two plates on edge rather than three: at 2px wide with a gap they read as
  // test tubes, and three of them filled the tile with stripes. Three pixels
  // and a domed top is the narrowest a plate can be and still be a plate.
  for (const x of [2, 6]) {
    c.rect(x, 6, 3, 6, C.paleMint);
    c.rect(x, 5, 3, 1, C.paper);
    c.rect(x, 6, 1, 6, C.paper);
    c.set(x, 5, C.none); // knock the corners off the dome
    c.set(x + 2, 5, C.none);
    c.rect(x, 12, 3, 1, C.mint);
  }
  // An upturned mug at the end, so the rack is not just a row of bars.
  c.rect(10, 8, 4, 4, C.paper);
  c.rect(10, 8, 4, 1, C.paleMint);
  c.set(14, 9, C.paper);
  c.set(14, 10, C.paper);
  // Wire tray: a dark rim with the runners showing through.
  c.rect(1, 13, 14, 2, C.steelDim);
  c.rect(1, 12, 14, 1, C.steel);
  for (const x of [3, 6, 9, 12]) c.set(x, 14, C.dark);
  c.rect(1, 15, 14, 1, C.dark);
  emit('DISH_RACK', 'Dish Rack', c, 1, 1, { category: 'misc', canPlaceOnSurfaces: true });
}
