/**
 * Counting the tokens one turn spent, from the transcript that turn wrote.
 *
 * This runs in the HOOK, on the machine that owns the transcript, because that
 * is the only place the number exists: a teammate's transcript never reaches
 * the office. What travels is a single integer and an id to deduplicate it --
 * no text, no paths, nothing the masking rules would object to.
 */

import * as fs from 'fs';

/** How much of the transcript's tail to read looking for the newest usage.
 *  A turn's records are the last thing written, so this only has to be big
 *  enough to contain one turn -- reading the whole file every turn would make
 *  a hook that runs on every event scale with session length. */
const TAIL_BYTES = 256 * 1024;

export interface TurnTokens {
  /** Tokens attributable to this turn. */
  tokens: number;
  /** Identifies the turn, so the office can ignore a repeat report. Claude
   *  fires Stop more than once in some flows, and a leaderboard that
   *  double-counts is worse than one that misses. */
  turnId: string;
}

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

/**
 * What "tokens used" means here: what the turn actually caused to be
 * processed, minus the cache re-reads.
 *
 * `cache_read_input_tokens` is the same context being re-sent every single
 * turn. Including it would make the leaderboard mostly measure how long
 * somebody has had a session open, which is neither interesting nor fair --
 * a long idle session would outrank an afternoon of real work. Cache
 * CREATION is counted, because that is context this turn genuinely added.
 */
function turnCost(usage: Usage): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.output_tokens ?? 0)
  );
}

/**
 * Read the newest turn's token count out of a transcript.
 *
 * Returns null whenever the answer is not clearly known -- unreadable file,
 * no usage in the tail, an all-zero usage block (which synthetic records emit
 * and which means "no news", not "a free turn"). A leaderboard is allowed to
 * miss a turn; it is not allowed to invent one.
 */
export function readTurnTokens(transcriptPath: string): TurnTokens | null {
  let tail: string;
  try {
    const { size } = fs.statSync(transcriptPath);
    const start = Math.max(0, size - TAIL_BYTES);
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const length = size - start;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      tail = buffer.toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }

  const lines = tail.split('\n');
  // Backwards: the newest usage is the one this turn just produced. The first
  // line of the tail is usually a partial record, which simply fails to parse.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line || !line.includes('usage')) continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = record.message as { usage?: Usage; id?: string } | undefined;
    const usage = message?.usage;
    if (!usage) continue;

    const tokens = turnCost(usage);
    if (tokens <= 0) continue; // synthetic record: no news, not a free turn

    // Prefer the API's own message id; fall back to the record uuid. Either is
    // stable for one turn and meaningless outside this machine.
    const turnId =
      (typeof message?.id === 'string' && message.id) ||
      (typeof record.uuid === 'string' && record.uuid) ||
      '';
    if (!turnId) continue;

    return { tokens, turnId };
  }
  return null;
}
