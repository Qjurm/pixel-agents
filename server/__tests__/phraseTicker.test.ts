import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { phrasesFor } from '../src/activityMask.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { PHRASE_ROTATE_INTERVAL_MS } from '../src/constants.js';
import { startPhraseTicker } from '../src/phraseTicker.js';
import type { AgentState } from '../src/types.js';

let timer: ReturnType<typeof setInterval> | undefined;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  if (timer) clearInterval(timer);
  timer = undefined;
  vi.useRealTimers();
});

function busyAgent(toolId: string, toolName: string): AgentState {
  return {
    id: 1,
    sessionId: 's',
    terminalRef: undefined,
    isExternal: true,
    projectDir: '/p',
    jsonlFile: '',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set([toolId]),
    activeToolStatuses: new Map([[toolId, 'initial']]),
    activeToolNames: new Map([[toolId, toolName]]),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    hookDelivered: true,
    lastDataAt: Date.now(),
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    contextTokens: 0,
    maxContextTokens: 200_000,
  } as AgentState;
}

/**
 * A phrase picked once and held until the tool finished made a long-running
 * command look like a frozen character. These pin that the words move, that
 * only the words move, and that an idle office stays silent.
 */
describe('startPhraseTicker', () => {
  it('re-labels a busy agent without changing its tool', () => {
    const store = new AgentStateStore();
    store.set(1, busyAgent('t-1', 'Bash'));
    const sent: Record<string, unknown>[] = [];
    store.on('broadcast', (m) => sent.push(m));

    timer = startPhraseTicker(store);
    vi.advanceTimersByTime(PHRASE_ROTATE_INTERVAL_MS);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('agentToolStart');
    expect(sent[0]!.toolId).toBe('t-1');
    // Same tool, same id: only the words are allowed to move, or the character
    // would change animation every five seconds.
    expect(sent[0]!.toolName).toBe('Bash');
    expect(phrasesFor('running')).toContain(sent[0]!.status);
  });

  it('keeps changing the words as time passes', () => {
    const store = new AgentStateStore();
    store.set(1, busyAgent('t-1', 'Bash'));
    const seen = new Set<string>();
    store.on('broadcast', (m) => seen.add(m.status as string));

    timer = startPhraseTicker(store);
    vi.advanceTimersByTime(PHRASE_ROTATE_INTERVAL_MS * 8);

    // Not eight distinct phrases necessarily -- the seed may repeat one -- but
    // a ticker that emitted a single phrase forever would be the bug.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('says nothing about an agent with no tool running', () => {
    const store = new AgentStateStore();
    const idle = busyAgent('t-1', 'Bash');
    idle.activeToolStatuses.clear();
    idle.activeToolNames.clear();
    store.set(1, idle);
    const sent: Record<string, unknown>[] = [];
    store.on('broadcast', (m) => sent.push(m));

    timer = startPhraseTicker(store);
    vi.advanceTimersByTime(PHRASE_ROTATE_INTERVAL_MS * 3);

    expect(sent).toEqual([]);
  });

  it('records the new label on the agent, so a reconnect sees the current one', () => {
    // agentActivityResend replays activeToolStatuses to a client that joins
    // mid-turn; leaving the stale phrase there would hand newcomers a label
    // nobody else is seeing.
    const store = new AgentStateStore();
    const agent = busyAgent('t-1', 'Read');
    store.set(1, agent);

    timer = startPhraseTicker(store);
    vi.advanceTimersByTime(PHRASE_ROTATE_INTERVAL_MS);

    expect(agent.activeToolStatuses.get('t-1')).not.toBe('initial');
    expect(phrasesFor('reading')).toContain(agent.activeToolStatuses.get('t-1'));
  });
});
