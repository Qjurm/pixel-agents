import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Leaderboard } from '../src/leaderboard.js';
import { readTurnTokens } from '../src/turnTokens.js';

let tmpDir: string;
let file: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-scores-'));
  file = path.join(tmpDir, 'leaderboard.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Leaderboard', () => {
  it('adds up turns per person, highest first', () => {
    const board = new Leaderboard(file);
    board.record('sanne', 't1', 1000);
    board.record('joost', 't2', 400);
    board.record('sanne', 't3', 500);

    expect(board.standings()).toEqual([
      { user: 'sanne', tokens: 1500, turns: 2 },
      { user: 'joost', tokens: 400, turns: 1 },
    ]);
  });

  it('counts a turn once, however often it is reported', () => {
    // Claude fires Stop more than once in some flows. Double-counting a turn
    // is worse than missing one, so the turn id is the guard.
    const board = new Leaderboard(file);
    expect(board.record('sanne', 't1', 1000)).toBe(true);
    expect(board.record('sanne', 't1', 1000)).toBe(false);
    expect(board.standings()[0]).toEqual({ user: 'sanne', tokens: 1000, turns: 1 });
  });

  it("does not let one person's repeat swallow another's turn", () => {
    // Ids come from different machines and could collide, so they are scoped
    // by user before being remembered.
    const board = new Leaderboard(file);
    board.record('sanne', 'same-id', 1000);
    board.record('joost', 'same-id', 700);
    expect(board.standings()).toHaveLength(2);
  });

  it('refuses nonsense rather than recording it', () => {
    const board = new Leaderboard(file);
    expect(board.record('', 't', 100)).toBe(false);
    expect(board.record('sanne', '', 100)).toBe(false);
    expect(board.record('sanne', 't', 0)).toBe(false);
    expect(board.record('sanne', 't', -5)).toBe(false);
    expect(board.record('sanne', 't', Number.NaN)).toBe(false);
    expect(board.standings()).toEqual([]);
  });

  it('survives a restart', () => {
    // A scoreboard that resets whenever the office restarts is not a
    // scoreboard.
    const first = new Leaderboard(file);
    first.record('sanne', 't1', 1234);
    first.persist();

    expect(new Leaderboard(file).standings()).toEqual([{ user: 'sanne', tokens: 1234, turns: 1 }]);
  });

  it('starts empty rather than throwing on a corrupt file', () => {
    fs.writeFileSync(file, '{ not json');
    expect(new Leaderboard(file).standings()).toEqual([]);
  });
});

describe('readTurnTokens', () => {
  function transcript(lines: unknown[]): string {
    const p = path.join(tmpDir, 'session.jsonl');
    fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n'));
    return p;
  }

  it('counts what the turn spent, excluding the cache it merely re-read', () => {
    // Cache reads are the same context re-sent every turn. Counting them would
    // rank whoever has had a session open longest, which is neither fair nor
    // interesting.
    const p = transcript([
      {
        type: 'assistant',
        uuid: 'u1',
        message: {
          id: 'msg_1',
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 900,
            cache_read_input_tokens: 50_000,
            output_tokens: 250,
          },
        },
      },
    ]);
    expect(readTurnTokens(p)).toEqual({ tokens: 1250, turnId: 'msg_1' });
  });

  it('takes the newest usage, not the first', () => {
    const p = transcript([
      { type: 'assistant', uuid: 'a', message: { id: 'old', usage: { output_tokens: 10 } } },
      { type: 'assistant', uuid: 'b', message: { id: 'new', usage: { output_tokens: 99 } } },
    ]);
    expect(readTurnTokens(p)?.turnId).toBe('new');
  });

  it('ignores an all-zero usage block', () => {
    // Synthetic records (API errors, interrupts) report zeros. That means "no
    // news", not "a free turn".
    const p = transcript([
      {
        type: 'assistant',
        uuid: 'a',
        message: { id: 'm', usage: { input_tokens: 0, output_tokens: 0 } },
      },
    ]);
    expect(readTurnTokens(p)).toBeNull();
  });

  it('returns null for a file that is not there', () => {
    expect(readTurnTokens(path.join(tmpDir, 'nope.jsonl'))).toBeNull();
  });
});
