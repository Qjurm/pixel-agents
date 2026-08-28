#!/usr/bin/env node
/**
 * Generate the CODE14 office layout.
 *
 * Hand-placing sixty seats in the in-app editor is an afternoon of clicking and
 * impossible to adjust afterwards; describing the floor plan in code means the
 * pod spacing, the seat count and the branding are all one edit away. Run it
 * again after changing a constant and the whole office re-flows.
 *
 *   node scripts/generate-office-layout.mjs
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
const COLS = 30;
const ROWS = 32;

/** A pod is one desk with three chairs tucked under it. Three tiles of chair
 *  means three seats, because seats are derived per chair FOOTPRINT TILE. */
const POD_W = 3;
const POD_COLS = [2, 7, 12, 17, 22];
const POD_ROWS = [4, 9, 14, 19];

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
  furniture.push({ uid: nextUid(), type, col, row });
}

// ── Floor ────────────────────────────────────────────────────
// Two zones so the room reads as a workspace and a lounge rather than one hall.
// The colours are the floor tiles' HSBC controls, not literal RGB: warm wood
// for the desks, a cooler tone for the lounge.
const WOOD = { h: 28, s: 34, b: -12, c: -30 };
const LOUNGE = { h: 168, s: 22, b: -18, c: -34 };

fill(1, 2, COLS - 2, 23, TILE.FLOOR_7, WOOD);
fill(1, 24, COLS - 2, ROWS - 2, TILE.FLOOR_1, LOUNGE);

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
// A low divider between the two zones, left open at both ends so nobody has to
// path all the way around to reach the coffee.
for (let c = 6; c <= COLS - 7; c++) setTile(c, 24, TILE.WALL);

// ── Desk pods ────────────────────────────────────────────────
// WHITE_DESK_MACBOOK is category "desks", so characters treat it as a
// workstation and the chairs below face up into it. Its off/on pair lights the
// screen when somebody is actually sitting there. White sit-stand frames,
// because that is what the office actually runs on.
let seats = 0;
for (const row of POD_ROWS) {
  for (const col of POD_COLS) {
    place('WHITE_DESK_MACBOOK_OFF', col, row);
    for (let i = 0; i < POD_W; i++) {
      place('CUSHIONED_CHAIR_BACK', col + i, row + 2);
      seats++;
    }
  }
}

// ── Branding on the back wall ────────────────────────────────
place('CODE14_SLOGAN', 3, 0);
place('CODE14_LOGO', 8, 0);
place('ISO_CERTIFICATE', 12, 0);
place('SCALEWARE_SIGN', 16, 0);
place('HOGEPAD_SIGN', 21, 0);
place('CLOCK', 26, 0);

// Side-wall pieces, spaced down the right-hand wall.
place('CODE14_PANEL', COLS - 2, 6);
place('SMALL_PAINTING', COLS - 2, 11);
place('CODE14_PANEL', COLS - 2, 16);
place('PADEL_RACKET', COLS - 2, 21);

// ── Greenery, so the aisles are not bare ─────────────────────
for (const row of [5, 10, 15, 20]) {
  place('PLANT', COLS - 4, row);
  place('PLANT_2', 27, row + 2);
}
place('LARGE_PLANT', 2, 24 - 3);

// ── Lounge: coffee, sofas, and Wednesday ─────────────────────
place('SOFA_BACK', 4, 26);
place('SOFA_BACK', 6, 26);
place('COFFEE_TABLE', 5, 28);
place('SOFA_FRONT', 4, 30);
place('SOFA_FRONT', 6, 30);

place('TABLE_FRONT', 12, 26);
for (let i = 0; i < 3; i++) place('CUSHIONED_CHAIR_BACK', 12 + i, 25);
for (let i = 0; i < 3; i++) place('CUSHIONED_CHAIR_FRONT', 12 + i, 30);
// The lunch table is where gehaktbalwoensdag and the daily bread live.
place('GEHAKTBAL_PAN', 13, 27);
place('BREAD_BASKET', 14, 27);
place('COFFEE', 12, 27);

place('WHITEBOARD', 20, 25);
place('DOUBLE_BOOKSHELF', 24, 26);
place('BIN', 26, 30);
place('LARGE_PLANT', 22, 28);

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
writeFileSync(join(ASSETS, 'default-layout-1.json'), json);
writeFileSync(join(ASSETS, 'code14-office-layout.json'), json);

console.log(`CODE14 office: ${COLS}x${ROWS}, ${furniture.length} pieces, ${seats} seats`);
console.log('  → webview-ui/public/assets/default-layout-1.json  (new offices)');
console.log('  → webview-ui/public/assets/code14-office-layout.json  (Settings → Import Layout)');
