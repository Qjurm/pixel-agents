/**
 * Who has burned the most tokens.
 *
 * The office cannot compute this itself: token counts live in each machine's
 * own transcript, and a teammate's transcript is not on this disk. So every
 * machine reports one integer per finished turn (turnTokens.ts) and this adds
 * them up per person.
 *
 * Persisted, because a scoreboard that resets whenever somebody restarts the
 * office is not a scoreboard. Kept in its own file rather than in config.json:
 * it is append-mostly runtime data, not settings, and losing it should never
 * take a user's preferences with it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LEADERBOARD_FILE_NAME, SERVER_JSON_DIR } from './constants.js';

export interface LeaderboardEntry {
  /** Display name, as the person joined with. */
  user: string;
  /** Tokens attributed to them, all-time. */
  tokens: number;
  /** Finished turns counted, so a huge total from one turn is distinguishable
   *  from a long afternoon of small ones. */
  turns: number;
}

interface Persisted {
  version: 1;
  entries: LeaderboardEntry[];
}

export function leaderboardPath(): string {
  return path.join(os.homedir(), SERVER_JSON_DIR, LEADERBOARD_FILE_NAME);
}

/**
 * The running scoreboard.
 *
 * Deduplication is the whole reason turn ids travel with the counts: Claude
 * fires Stop more than once in some flows, and a leaderboard that
 * double-counts a turn is worse than one that misses it. The seen-set is
 * per-process and bounded -- it only has to outlive the repeats, which arrive
 * seconds apart, not restarts.
 */
export class Leaderboard {
  private totals = new Map<string, LeaderboardEntry>();
  private seenTurns = new Set<string>();
  private dirty = false;

  constructor(private readonly filePath: string = leaderboardPath()) {
    this.load();
  }

  /** Add a finished turn. Returns true when it actually counted, so the caller
   *  can avoid broadcasting a scoreboard that did not change. */
  record(user: string, turnId: string, tokens: number): boolean {
    if (!user || !turnId || !Number.isFinite(tokens) || tokens <= 0) return false;
    // Scope the id by user: two machines could in principle mint the same id,
    // and one person's repeat must not suppress another person's turn.
    const key = `${user}:${turnId}`;
    if (this.seenTurns.has(key)) return false;
    this.seenTurns.add(key);

    const entry = this.totals.get(user) ?? { user, tokens: 0, turns: 0 };
    entry.tokens += Math.round(tokens);
    entry.turns += 1;
    this.totals.set(user, entry);
    this.dirty = true;
    return true;
  }

  /** Highest first. Ties break on name so the order is stable between reads. */
  standings(): LeaderboardEntry[] {
    return [...this.totals.values()].sort(
      (a, b) => b.tokens - a.tokens || a.user.localeCompare(b.user),
    );
  }

  /** Write only when something changed: this is called on a timer. */
  persist(): void {
    if (!this.dirty) return;
    const payload: Persisted = { version: 1, entries: this.standings() };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      // tmp + rename, so a crash mid-write cannot leave a truncated scoreboard
      // where a readable one used to be.
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
      fs.renameSync(tmp, this.filePath);
      this.dirty = false;
    } catch (err) {
      console.error(
        `[Pixel Agents] Could not save the leaderboard: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Start over. */
  reset(): void {
    this.totals.clear();
    this.seenTurns.clear();
    this.dirty = true;
    this.persist();
  }

  private load(): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch {
      return; // no scoreboard yet, or an unreadable one: start empty
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as Persisted).version !== 1 ||
      !Array.isArray((parsed as Persisted).entries)
    ) {
      return;
    }
    for (const entry of (parsed as Persisted).entries) {
      if (
        typeof entry?.user === 'string' &&
        entry.user.length > 0 &&
        Number.isFinite(entry.tokens) &&
        Number.isFinite(entry.turns)
      ) {
        this.totals.set(entry.user, {
          user: entry.user,
          tokens: Math.max(0, Math.round(entry.tokens)),
          turns: Math.max(0, Math.round(entry.turns)),
        });
      }
    }
  }
}
