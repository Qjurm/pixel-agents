#!/usr/bin/env node
/**
 * Turn a photo of a colleague into a framed pixel-art portrait for the office wall.
 *
 *   node scripts/photo-to-frame.mjs <image-path> <NAME> [--size 2x2]
 *
 * Nothing is fetched: the photo comes off your own disk and never leaves it.
 * Deliberately dependency-free -- the repo has no image library and installing
 * one to resize a handful of avatars is a bad trade, so zlib does the codec
 * work and the resampling/quantising below is written out longhand.
 *
 * Writes webview-ui/public/assets/furniture/PHOTO_<NAME>/, which esbuild copies
 * to dist/assets/ and the server serves to every office viewer.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FURNITURE = join(ROOT, 'webview-ui', 'public', 'assets', 'furniture');

/** CODE14's palette, mirrored from server/src/brandPalette.ts as RGBA bytes.
 *  Only the frame uses these -- the photo keeps its own colours, because a
 *  face forced into five brand tones stops being a likeness of anyone. */
const C = {
  dark: [0x25, 0x36, 0x37, 255],
  darker: [0x1c, 0x29, 0x2a, 255],
  paleMint: [0xd2, 0xe7, 0xe2, 255],
  paper: [0xf2, 0xf2, 0xf0, 255],
  none: [0, 0, 0, 0],
};

/** Frame geometry per supported footprint. `photo` is the pixel size of the
 *  image window; everything else is border and mat drawn around it.
 *  `photoTop` sits the window slightly high in the tall frame, the way a real
 *  mat cutter leaves more board under a portrait than over it. */
const SIZES = {
  '2x2': { w: 32, h: 32, footprintW: 2, footprintH: 2, photo: 22, photoTop: 4 },
  '1x2': { w: 16, h: 32, footprintW: 1, footprintH: 2, photo: 8, photoTop: 10 },
};

/* ------------------------------------------------------------------ PNG io */

/**
 * Read a PNG into { w, h, px } RGBA bytes.
 *
 * Same approach as scripts/generate-brand-assets.mjs's reader (all five row
 * filters), widened to accept the truecolour-without-alpha files that come out
 * of a camera or `sips`. Anything more exotic is rejected loudly further down:
 * silently mis-decoding a palette image would produce a frame full of noise
 * that looks like a bug in the downsampler rather than an unsupported format.
 */
function readPng(file) {
  const d = readFileSync(file);
  let pos = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (pos + 8 <= d.length) {
    const len = d.readUInt32BE(pos);
    const type = d.toString('ascii', pos + 4, pos + 8);
    if (type === 'IHDR') {
      w = d.readUInt32BE(pos + 8);
      h = d.readUInt32BE(pos + 12);
      depth = d[pos + 16];
      colorType = d[pos + 17];
      interlace = d[pos + 20];
    } else if (type === 'IDAT') {
      idat.push(d.subarray(pos + 8, pos + 8 + len));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }

  if (interlace !== 0) {
    fail(
      'This PNG is interlaced (Adam7), which this reader does not handle.\n' +
        `  Re-save it non-interlaced:  sips -s format png "${file}" --out converted.png`,
    );
  }
  if (colorType !== 2 && colorType !== 6) {
    const kind = { 0: 'greyscale', 3: 'palette (indexed)', 4: 'greyscale+alpha' }[colorType];
    fail(
      `This PNG is ${kind ?? `colour type ${colorType}`}; only RGB and RGBA are supported.\n` +
        `  Convert it:  sips -s format png "${file}" --out converted.png`,
    );
  }
  if (depth !== 8) {
    fail(
      `This PNG is ${depth} bits per channel; only 8 is supported.\n` +
        `  Convert it:  sips -s format png "${file}" --out converted.png`,
    );
  }
  if (!idat.length) fail('This PNG has no image data.');

  const chans = colorType === 6 ? 4 : 3;
  const stride = w * chans;
  const raw = inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0, i = 0; y < h; y++) {
    const filter = raw[i++];
    const line = new Uint8Array(raw.subarray(i, i + stride));
    i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= chans ? line[x - chans] : 0;
      const b = prev[x];
      const c = x >= chans ? prev[x - chans] : 0;
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
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      px[o] = line[x * chans];
      px[o + 1] = line[x * chans + 1];
      px[o + 2] = line[x * chans + 2];
      px[o + 3] = chans === 4 ? line[x * chans + 3] : 255;
    }
    prev = line;
  }
  return { w, h, px };
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

function toPng(img) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rowLen = img.w * 4;
  const raw = Buffer.alloc(img.h * (rowLen + 1));
  for (let y = 0; y < img.h; y++) {
    raw[y * (rowLen + 1)] = 0; // no filter
    Buffer.from(img.px.buffer, img.px.byteOffset + y * rowLen, rowLen).copy(
      raw,
      y * (rowLen + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------- pixel-ising */

/**
 * Centre-crop to a square.
 *
 * Done before any resampling: squeezing a 3:4 portrait into a square window
 * stretches a face wider than it is, and at 22 pixels that distortion is most
 * of what you see. Tall crops are biased upwards because heads sit in the top
 * half of a portrait -- a true centre crop on a standing shot frames a chest.
 */
function cropSquare(img) {
  const side = Math.min(img.w, img.h);
  const x0 = Math.round((img.w - side) / 2);
  const y0 = img.h > img.w ? Math.round((img.h - side) * 0.25) : Math.round((img.h - side) / 2);
  const px = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    const src = ((y0 + y) * img.w + x0) * 4;
    px.set(img.px.subarray(src, src + side * 4), y * side * 4);
  }
  return { w: side, h: side, px };
}

/**
 * Box-average downsample: every target pixel is the mean of all source pixels
 * that fall inside it.
 *
 * Nearest-neighbour was tried first and is unusable here -- sampling 22 of a
 * few million pixels throws away the whole face and keeps whatever noise
 * happened to land on the grid. Averaging is also why this is done in linear
 * light: averaging sRGB bytes darkens every mid-tone, which on skin reads as
 * grime. Alpha is composited onto paper first so cut-out avatars do not average
 * their subject towards transparent black.
 */
function boxDownsample(img, size) {
  const out = new Float64Array(size * size * 3);
  const counts = new Float64Array(size * size);
  const lin = srgbToLinearTable();
  for (let y = 0; y < img.h; y++) {
    const ty = Math.min(size - 1, Math.floor((y * size) / img.h));
    for (let x = 0; x < img.w; x++) {
      const tx = Math.min(size - 1, Math.floor((x * size) / img.w));
      const s = (y * img.w + x) * 4;
      const a = img.px[s + 3] / 255;
      const t = (ty * size + tx) * 3;
      for (let ch = 0; ch < 3; ch++) {
        out[t + ch] += lin[img.px[s + ch]] * a + lin[C.paper[ch]] * (1 - a);
      }
      counts[ty * size + tx]++;
    }
  }
  const px = new Float64Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const n = counts[i] || 1;
    for (let ch = 0; ch < 3; ch++) px[i * 3 + ch] = out[i * 3 + ch] / n;
  }
  return px; // linear-light RGB in 0..1
}

let LIN_TABLE = null;
function srgbToLinearTable() {
  if (!LIN_TABLE) {
    LIN_TABLE = new Float64Array(256);
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      LIN_TABLE[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
  }
  return LIN_TABLE;
}

function linearToSrgb(v) {
  const c = Math.min(1, Math.max(0, v));
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** How far up the tone stretch may drag the black point, in linear light.
 *  See punchUp. There is deliberately no matching cap on the white point: an
 *  underexposed photo needs its highlights lifted all the way, and nothing
 *  breaks if they are. */
const BLACK_POINT_CAP = 0.12;

/**
 * Stretch the tones and push the colours apart, in that order.
 *
 * The downsample above is a heavy blur, so the shrunken image always comes back
 * flatter than the original; the quantiser then collapses those neighbouring
 * tones into one and the face goes featureless. Normalising to the image's own
 * 2nd/98th percentile (rather than a fixed curve) puts the darkest hair and the
 * brightest highlight back at the ends of the range whatever the lighting was,
 * and the saturation lift keeps lips and clothing from quantising into skin.
 */
function punchUp(px, size) {
  const n = size * size;
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = 0.2126 * px[i * 3] + 0.7152 * px[i * 3 + 1] + 0.0722 * px[i * 3 + 2];
  }
  const sorted = Float64Array.from(lum).sort();
  // The black point can only be dragged so far up. Unclamped, an image whose
  // darkest 2% IS the subject -- a cut-out avatar, a logo, anything on a plain
  // ground -- has that subject mapped straight to black. A real photograph's
  // shadows sit well below the cap, so its stretch is unaffected.
  const lo = Math.min(sorted[Math.floor(n * 0.02)], BLACK_POINT_CAP);
  const hi = sorted[Math.min(n - 1, Math.floor(n * 0.98))];
  const span = Math.max(1e-4, hi - lo);
  const out = new Float64Array(px.length);
  for (let i = 0; i < n; i++) {
    const l = lum[i];
    // Only most of the way to a full normalisation: an image whose histogram
    // is already two flat blobs (a logo, a cut-out on a plain ground) has a
    // percentile range so narrow that a full stretch slams one blob to black.
    const stretched = Math.min(1, Math.max(0, (l - lo) / span));
    // Gentle S-curve on top of the stretch: separates the cheek from the
    // shadow beside it, which is the edge that makes a face read at 22px.
    const curved = stretched * stretched * (3 - 2 * stretched) * 0.55 + stretched * 0.45;
    const gain = l > 1e-4 ? curved / l : 0;
    for (let ch = 0; ch < 3; ch++) {
      const scaled = px[i * 3 + ch] * gain;
      out[i * 3 + ch] = curved + (scaled - curved) * 1.35; // saturation about the new luma
    }
  }
  return out;
}

/**
 * Unsharp mask at the target resolution.
 *
 * The features that decide whether a face is recognisable at 22px -- eyes,
 * nostrils, the line of a mouth -- are one or two pixels wide by the time the
 * box filter is done with them, and each is an average of dark feature and pale
 * skin. Sharpening here rather than before the resize is the point: this is the
 * scale the detail has to survive at, and a 3x3 kernel on the small image is
 * the same operation as a huge blur radius on the original.
 */
function sharpen(px, size, amount) {
  const out = new Float64Array(px.length);
  const at = (x, y, ch) =>
    px[(Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))) * 3 + ch];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let blur = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            blur +=
              at(x + dx, y + dy, ch) * (dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1);
          }
        }
        blur /= 16;
        const v = px[(y * size + x) * 3 + ch];
        out[(y * size + x) * 3 + ch] = Math.min(1, Math.max(0, v + (v - blur) * amount));
      }
    }
  }
  return out;
}

/**
 * Median-cut down to `k` colours, then a few Lloyd passes.
 *
 * Median cut alone gives well-spread but slightly off centres; plain k-means
 * from random seeds on a few hundred pixels regularly loses a whole feature
 * (eyes and hair merge) depending on the seed. Median cut as the seed and
 * k-means as the polish is stable run to run, which matters when the same photo
 * has to produce the same frame twice.
 *
 * Deliberately unweighted. Weighting the samples towards the middle of the
 * window was tried, on the theory that the subject is centred and the wall is
 * not -- it made every face WORSE. The middle of a portrait is mostly flat
 * cheek, so the extra weight bought more near-identical skin tones and paid for
 * them by merging the eyes, which are a handful of pixels, into the skin. The
 * few dark pixels that make a face readable need protecting from the palette,
 * not the large smooth areas.
 */
function quantise(px, size, k) {
  const n = size * size;
  const idx = Array.from({ length: n }, (_, i) => i);
  let boxes = [idx];
  while (boxes.length < k) {
    // Always split the box with the widest channel spread: splitting by
    // population instead keeps subdividing the background wall.
    let best = -1;
    let bestSpread = -1;
    let bestCh = 0;
    boxes.forEach((box, bi) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const i of box) {
          const v = px[i * 3 + ch];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (hi - lo > bestSpread) {
          bestSpread = hi - lo;
          best = bi;
          bestCh = ch;
        }
      }
    });
    if (best < 0 || bestSpread <= 0) break;
    const box = boxes[best].slice().sort((a, b) => px[a * 3 + bestCh] - px[b * 3 + bestCh]);
    const mid = box.length >> 1;
    boxes.splice(best, 1, box.slice(0, mid), box.slice(mid));
  }

  let centres = boxes.map((box) => {
    const c = [0, 0, 0];
    for (const i of box) for (let ch = 0; ch < 3; ch++) c[ch] += px[i * 3 + ch];
    return c.map((v) => v / box.length);
  });

  const assign = new Int32Array(n);
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let bi = 0;
      let bd = Infinity;
      centres.forEach((c, ci) => {
        const dr = px[i * 3] - c[0];
        const dg = px[i * 3 + 1] - c[1];
        const db = px[i * 3 + 2] - c[2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) {
          bd = d;
          bi = ci;
        }
      });
      if (assign[i] !== bi) moved = true;
      assign[i] = bi;
    }
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      const s = sums[assign[i]];
      for (let ch = 0; ch < 3; ch++) s[ch] += px[i * 3 + ch];
      s[3]++;
    }
    centres = centres.map((c, ci) =>
      sums[ci][3] ? sums[ci].slice(0, 3).map((v) => v / sums[ci][3]) : c,
    );
    if (!moved) break;
  }

  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = centres[assign[i]];
    out[i * 4] = linearToSrgb(c[0]);
    out[i * 4 + 1] = linearToSrgb(c[1]);
    out[i * 4 + 2] = linearToSrgb(c[2]);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/* ------------------------------------------------------------------- frame */

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4);
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
}

/**
 * Draw the frame: two-tone dark moulding, a pale mint mat, a thin dark rebate,
 * then the photo. The moulding is two tones rather than one flat outline
 * because a single-colour rectangle at this scale reads as a hole in the wall;
 * the lighter top-left and darker bottom-right is the whole illusion of depth.
 * Corner pixels are dropped, the same trick the other office props use to read
 * as rounded without an actual radius.
 */
function drawFrame(spec, photo) {
  const c = new Canvas(spec.w, spec.h);
  c.rect(0, 0, spec.w, spec.h, C.darker);
  c.rect(1, 1, spec.w - 2, spec.h - 2, C.dark);
  c.rect(2, 2, spec.w - 4, spec.h - 4, C.paleMint);

  const px0 = Math.round((spec.w - spec.photo) / 2);
  const py0 = spec.photoTop;
  c.rect(px0 - 1, py0 - 1, spec.photo + 2, spec.photo + 2, C.darker);
  for (let y = 0; y < spec.photo; y++) {
    for (let x = 0; x < spec.photo; x++) {
      const o = (y * spec.photo + x) * 4;
      c.set(px0 + x, py0 + y, [photo[o], photo[o + 1], photo[o + 2], 255]);
    }
  }

  // A hairline of paper along the mat's top-left: catches the light the way the
  // bevel cut in a real mat board does, and stops the mat reading as flat card.
  for (let x = 2; x < spec.w - 2; x++) c.set(x, 2, C.paper);
  for (let y = 2; y < spec.h - 2; y++) c.set(2, y, C.paper);

  for (const [cx, cy] of [
    [0, 0],
    [spec.w - 1, 0],
    [0, spec.h - 1],
    [spec.w - 1, spec.h - 1],
  ]) {
    c.set(cx, cy, C.none);
  }
  return c;
}

/* -------------------------------------------------------------------- main */

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

const USAGE = 'usage: node scripts/photo-to-frame.mjs <image-path> <NAME> [--size 2x2|1x2]';

function parseArgs(argv) {
  const positional = [];
  let size = '2x2';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--size') size = argv[++i];
    else if (argv[i].startsWith('--size=')) size = argv[i].slice(7);
    else positional.push(argv[i]);
  }
  if (positional.length < 2) fail(USAGE);
  if (!SIZES[size]) fail(`Unknown --size "${size}". Supported: ${Object.keys(SIZES).join(', ')}`);
  return { file: positional[0], name: positional[1], size };
}

/** The id becomes a directory name and a manifest key, so it has to survive
 *  both a filesystem and JSON without quoting: uppercase, letters and digits. */
function toId(name) {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!slug) fail(`"${name}" has no letters or digits to build an asset id from.`);
  return `PHOTO_${slug}`;
}

function main() {
  const { file, name, size } = parseArgs(process.argv.slice(2));
  const spec = SIZES[size];

  let head;
  try {
    head = readFileSync(file).subarray(0, 8);
  } catch {
    fail(`Cannot read "${file}".\n${USAGE}`);
  }
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    const out = `${basename(file).replace(/\.[^.]+$/, '')}.png`;
    fail(
      'That is a JPEG, and this tool only reads PNG.\n' +
        'macOS can convert it for you with the built-in `sips`:\n\n' +
        `  sips -s format png "${file}" --out "${out}"\n\n` +
        `then re-run with "${out}".`,
    );
  }
  if (head.toString('hex') !== '89504e470d0a1a0a') {
    fail(`"${file}" is not a PNG. Convert it first:  sips -s format png "${file}" --out out.png`);
  }

  const src = readPng(file);
  const square = cropSquare(src);
  const small = sharpen(punchUp(boxDownsample(square, spec.photo), spec.photo), spec.photo, 0.9);
  // Fewer colours in the smaller window: 16 clusters over 100 pixels just
  // reproduces the blur, which defeats the point of quantising at all.
  const colours = spec.photo >= 16 ? 14 : 8;
  const photo = quantise(small, spec.photo, colours);

  const id = toId(name);
  const canvas = drawFrame(spec, photo);
  const dir = join(FURNITURE, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.png`), toPng(canvas));
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        id,
        name: `${name} Portrait`,
        category: 'wall',
        type: 'asset',
        canPlaceOnWalls: true,
        canPlaceOnSurfaces: false,
        backgroundTiles: 0,
        width: spec.w,
        height: spec.h,
        footprintW: spec.footprintW,
        footprintH: spec.footprintH,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`  ✓ ${id}  ${spec.w}x${spec.h}  (${spec.photo}px photo, ${colours} colours)`);
  console.log(`    ${join('webview-ui', 'public', 'assets', 'furniture', id)}`);
}

main();
