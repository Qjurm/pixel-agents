/**
 * The scoreboard page.
 *
 * Server-rendered like the join page, and for the same reason: it is something
 * you send a colleague a link to, and it must work without the office app
 * having loaded. It refreshes itself rather than holding a socket open --
 * nobody needs sub-minute precision on a leaderboard.
 */

import { CODE14 } from './brandPalette.js';

interface Entry {
  user: string;
  tokens: number;
  turns: number;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 1_234_567 -> "1.2M". Exact counts are noise here; the ranking is the point. */
function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function scoresPageHtml(entries: Entry[]): string {
  const top = entries[0]?.tokens ?? 0;
  const rows = entries.length
    ? entries
        .map((entry, i) => {
          // Bar length is relative to the leader, so the shape of the race is
          // readable without anybody having to compare six-digit numbers.
          const pct = top > 0 ? Math.max(2, Math.round((entry.tokens / top) * 100)) : 0;
          return `<li>
        <span class="rank">${String(i + 1)}</span>
        <span class="who">${esc(entry.user)}</span>
        <span class="bar"><span style="width:${String(pct)}%"></span></span>
        <span class="num">${short(entry.tokens)}</span>
        <span class="turns">${String(entry.turns)} ${entry.turns === 1 ? 'turn' : 'turns'}</span>
      </li>`;
        })
        .join('\n      ')
    : '<li class="empty">Nobody has finished a turn yet. Start Claude and come back.</li>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Token scoreboard</title>
<style>
  :root {
    --dark: ${CODE14.dark}; --coral: ${CODE14.coral}; --mint: ${CODE14.mint};
    --pale: ${CODE14.paleMint}; --paper: ${CODE14.paper}; --ink: ${CODE14.darker};
    --muted: ${CODE14.muted};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 3rem 1.25rem 5rem; background: var(--paper); color: var(--ink);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.6;
  }
  main { max-width: 40rem; margin: 0 auto; }
  .tag { color: var(--coral); font-size: .72rem; letter-spacing: .18em; text-transform: uppercase; }
  h1 { font-size: 1.9rem; margin: .4rem 0 .2rem; letter-spacing: -.02em; }
  p.sub { margin: 0 0 2rem; color: var(--muted); font-size: .86rem; max-width: 30rem; }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  li {
    display: grid; grid-template-columns: 1.6rem 8rem 1fr 4rem 5rem;
    gap: .75rem; align-items: center; padding: .6rem 0;
    border-top: 1px solid var(--pale); font-size: .88rem;
  }
  li:first-child { border-top: 0; }
  li.empty { display: block; color: var(--muted); }
  .rank { color: var(--muted); font-variant-numeric: tabular-nums; }
  .who { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  .bar { background: var(--pale); height: .6rem; border-radius: 1px; overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--coral); }
  li:not(:first-child) .bar > span { background: var(--mint); }
  .num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  .turns { text-align: right; color: var(--muted); font-size: .76rem; }
  footer { margin-top: 2.5rem; font-size: .78rem; color: var(--muted); }
  @media (max-width: 34rem) {
    li { grid-template-columns: 1.4rem 1fr 3.5rem; }
    .bar, .turns { display: none; }
  }
</style>
</head>
<body>
<main>
  <span class="tag">Pixel Agents</span>
  <h1>Token scoreboard</h1>
  <p class="sub">
    Counted per finished turn: what the turn sent and produced, not the cached
    context it re-read — otherwise this would rank whoever left a session open
    longest. Refreshes every minute.
  </p>
  <ol>
      ${rows}
  </ol>
  <footer>Also available as JSON at <a href="/api/leaderboard">/api/leaderboard</a>.</footer>
</main>
</body>
</html>`;
}
