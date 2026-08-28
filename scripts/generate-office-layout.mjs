#!/usr/bin/env node
/**
 * Generate the CODE14 office layout.
 *
 * Hand-placing sixty seats in the in-app editor is an afternoon of clicking and
 * impossible to adjust afterwards; describing the floor plan in code means the
 * pod spacing, the seat count and the branding are all one edit away. Run it
 * again after changing a constant and the whole office re-flows.
 *
 *   node scripts/generate-office-layout.mjs            the furnished office
 *   node scripts/generate-office-layout.mjs --empty    same room, nothing in it
 *
 * Writes webview-ui/public/assets/default-layout-1.json (what a fresh office
 * starts with) and a copy next to it that can be imported into an office that
 * already has a saved layout, via Settings -> Import Layout.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'webview-ui', 'public', 'assets');

const TILE = { WALL: 0, FLOOR_1: 1, FLOOR_7: 7, FLOOR_9: 9, VOID: 255 };

/** Grid. The renderer caps layouts at 64x64; this stays well inside it while
 *  leaving walking room around every pod -- characters path with BFS and a
 *  cramped floor makes them queue in the aisles. */
const COLS = 42;
const ROWS = 35;

/** One desk, one chair -- a three-across bench per desk looked like a lecture
 *  hall, not a workspace. Seats are derived per chair footprint tile, so the
 *  seat count is simply the number of desks now, and the grid grew to keep the
 *  room in the 40-50 range that was asked for. */
const POD_COLS = [2, 7, 12, 17, 22, 27, 32, 37];
const POD_ROWS = [3, 7, 11, 15, 19, 23];

/** --empty gives the same walled, floored room with no furniture at all: a
 *  canvas to build on by hand. Painting every tile from a blank grid in the
 *  editor is tedious, so the floor and walls stay -- it is the furniture that
 *  gets out of the way. */
const EMPTY = process.argv.includes('--empty');

const tiles = new Array(COLS * ROWS).fill(TILE.VOID);
const tileColors = new Array(COLS * ROWS).fill(null);
const furniture = [];

let uid = 0;
/** Stable ids rather than random ones, so regenerating produces the same file
 *  and a diff shows what actually changed. */
const nextUid = () => `c14-${String(++uid).padStart(3, '0')}`;

const at = (col, row) => row * COLS + col;

function setTile(col, row, type, color = null) {
  if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return;
  tiles[at(col, row)] = type;
  tileColors[at(col, row)] = color;
}

function fill(col0, row0, col1, row1, type, color = null) {
  for (let r = row0; r <= row1; r++) for (let c = col0; c <= col1; c++) setTile(c, r, type, color);
}

function place(type, col, row) {
  if (EMPTY) return;
  furniture.push({ uid: nextUid(), type, col, row });
}

// ── Floor ────────────────────────────────────────────────────
// Two zones so the room reads as a workspace and a lounge rather than one hall.
// The colours are the floor tiles' HSBC controls, not literal RGB: warm wood
// for the desks, a cooler tone for the lounge.
const WOOD = { h: 30, s: 16, b: -6, c: -48 };
const LOUNGE = { h: 172, s: 14, b: -10, c: -46 };

const LOUNGE_TOP = 27;
fill(1, 2, COLS - 2, LOUNGE_TOP - 1, TILE.FLOOR_7, WOOD);
fill(1, LOUNGE_TOP, COLS - 2, ROWS - 2, TILE.FLOOR_1, LOUNGE);

// ── Walls ────────────────────────────────────────────────────
// A closed perimeter: an open edge lets characters wander off the floor.
for (let c = 1; c <= COLS - 2; c++) {
  setTile(c, 1, TILE.WALL);
  setTile(c, ROWS - 1, TILE.WALL);
}
for (let r = 1; r <= ROWS - 1; r++) {
  setTile(1, r, TILE.WALL);
  setTile(COLS - 2, r, TILE.WALL);
}
// No divider between the two zones. A wall here rendered as a long pale bar
// straight across the room -- it read as a reception counter, not as a
// partition -- and an open plan is what the place actually is. The floor change
// is enough to say "this part is the lounge".

// ── Desk pods ────────────────────────────────────────────────
// WHITE_DESK_MACBOOK is category "desks", so characters treat it as a
// workstation and the chairs below face up into it. Its off/on pair lights the
// screen when somebody is actually sitting there. White sit-stand frames,
// because that is what the office actually runs on.
let seats = 0;
for (const row of POD_ROWS) {
  for (const col of POD_COLS) {
    place('WHITE_DESK_MACBOOK_OFF', col, row);
    // Centred under the three-tile desk, facing up into it.
    place('OFFICE_CHAIR_BACK', col + 1, row + 2);
    seats++;
  }
}

// ── Branding on the back wall ────────────────────────────────
place('CODE14_SLOGAN', 3, 0);
place('CODE14_LOGO', 8, 0);
place('ISO_CERTIFICATE', 12, 0);
place('SCALEWARE_SIGN', 17, 0);
place('HOGEPAD_SIGN', 23, 0);
place('CODE14_PANEL', 28, 0);
place('CLOCK', 32, 0);
place('LARGE_PAINTING', 35, 0);

// Nothing on the side walls. Wall pieces are drawn as if you are looking
// straight at them, so on a wall running away from the camera they hang at the
// wrong angle and read as floating boards. The back wall is the only one that
// faces the viewer, so that is where signage goes.

// ── Greenery, so the aisles are not bare ─────────────────────
// Greenery in the aisle down the right, well clear of the wall.
for (const row of [4, 10, 16, 22]) place('PLANT', COLS - 3, row);
place('LARGE_PLANT', COLS - 4, LOUNGE_TOP - 4);

// ── Lounge: coffee, sofas, and Wednesday ─────────────────────
place('SOFA_BACK', 4, LOUNGE_TOP + 1);
place('SOFA_BACK', 6, LOUNGE_TOP + 1);
place('COFFEE_TABLE', 5, LOUNGE_TOP + 3);
place('SOFA_FRONT', 4, LOUNGE_TOP + 6);
place('SOFA_FRONT', 6, LOUNGE_TOP + 6);

place('TABLE_FRONT', 14, LOUNGE_TOP + 1);
for (let i = 0; i < 3; i++) place('CUSHIONED_CHAIR_BACK', 14 + i, LOUNGE_TOP);
for (let i = 0; i < 3; i++) place('CUSHIONED_CHAIR_FRONT', 14 + i, LOUNGE_TOP + 5);
// The lunch table is where gehaktbalwoensdag and the daily bread live.
place('GEHAKTBAL_PAN', 15, LOUNGE_TOP + 2);
place('BREAD_BASKET', 16, LOUNGE_TOP + 2);
place('COFFEE', 14, LOUNGE_TOP + 2);

place('WHITEBOARD', 24, LOUNGE_TOP);
place('DOUBLE_BOOKSHELF', 30, LOUNGE_TOP + 1);
place('BIN', 36, LOUNGE_TOP + 5);
place('LARGE_PLANT', 33, LOUNGE_TOP + 3);
place('PADEL_RACKET', 27, LOUNGE_TOP + 1);

const layout = {
  version: 1,
  cols: COLS,
  rows: ROWS,
  layoutRevision: 2,
  tiles,
  tileColors,
  furniture,
};

const json = `${JSON.stringify(layout)}\n`;
if (EMPTY) {
  // Deliberately NOT written over the bundled default: an empty room is a
  // scratch pad for one person, not what a fresh office should start as.
  writeFileSync(join(ASSETS, 'empty-office-layout.json'), json);
} else {
  writeFileSync(join(ASSETS, 'default-layout-1.json'), json);
  writeFileSync(join(ASSETS, 'code14-office-layout.json'), json);
}

if (EMPTY) {
  console.log(`Empty room: ${COLS}x${ROWS}, floor and walls only`);
  console.log('  → webview-ui/public/assets/empty-office-layout.json  (Settings → Import Layout)');
} else {
  console.log(`CODE14 office: ${COLS}x${ROWS}, ${furniture.length} pieces, ${seats} seats`);
  console.log('  → webview-ui/public/assets/default-layout-1.json  (new offices)');
  console.log('  → webview-ui/public/assets/code14-office-layout.json  (Settings → Import Layout)');
}
