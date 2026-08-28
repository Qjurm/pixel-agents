import { useEffect, useState } from 'react';

import { Modal } from './ui/Modal.js';

/** One person's running total, as /api/leaderboard reports it. */
interface Entry {
  user: string;
  tokens: number;
  turns: number;
}

interface LeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** How often the standings refresh while the panel is open. Slow on purpose:
 *  a scoreboard changes once per finished turn, and a tighter poll would spend
 *  more effort asking than the answer is worth. */
const REFRESH_MS = 15_000;

/** 1_234_567 -> "1.2M". The ranking is the point; exact digits are noise. */
function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * The token scoreboard, over the office.
 *
 * Reads /api/leaderboard rather than listening on the WebSocket. The wire
 * protocol is an AsyncAPI contract with generated bindings and a CI drift
 * check; something that changes once per turn and is only visible while a
 * panel is open does not earn a message type in it. Fetching also means the
 * panel is self-contained -- no state to thread through the transport, the
 * store, and App.
 */
export function LeaderboardModal({ isOpen, onClose }: LeaderboardModalProps) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // Guards against a response landing after the panel closed, or after a
    // newer request already answered.
    let cancelled = false;

    const load = () => {
      fetch('/api/leaderboard')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data: { entries?: Entry[] }) => {
          if (cancelled) return;
          setEntries(data.entries ?? []);
          setFailed(false);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isOpen]);

  const top = entries?.[0]?.tokens ?? 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Scoreboard">
      <div className="px-10 pb-4 min-w-sm">
        <p className="text-sm opacity-70 mb-4 max-w-sm">
          Tokens per finished turn — not the cached context re-read every turn, which would just
          rank whoever left a session open longest.
        </p>

        {failed && <p className="text-sm opacity-70">Could not reach the office for scores.</p>}

        {!failed && entries === null && <p className="text-sm opacity-70">Counting…</p>}

        {!failed && entries?.length === 0 && (
          <p className="text-sm opacity-70">Nobody has finished a turn yet.</p>
        )}

        {!failed && entries && entries.length > 0 && (
          <ol className="flex flex-col">
            {entries.map((entry, i) => (
              <li
                key={entry.user}
                className="flex items-center gap-4 py-2 border-b border-border last:border-b-0"
              >
                <span className="opacity-50 w-6 text-right tabular-nums">{i + 1}</span>
                <span className="flex-1 truncate">{entry.user}</span>
                {/* Bar length is relative to the leader, so the shape of the
                    race reads without comparing six-digit numbers. */}
                <span className="w-24 h-2 bg-border">
                  <span
                    className="block h-full bg-accent-bright"
                    style={{
                      width: `${String(top > 0 ? Math.max(3, (entry.tokens / top) * 100) : 0)}%`,
                    }}
                  />
                </span>
                <span className="w-14 text-right tabular-nums">{short(entry.tokens)}</span>
                <span className="w-16 text-right text-sm opacity-50">
                  {entry.turns} {entry.turns === 1 ? 'turn' : 'turns'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}
