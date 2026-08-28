import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import {
  EXTERNAL_STALE_CHECK_INTERVAL_MS,
  REMOTE_PRESENCE_CHECK_INTERVAL_MS,
  REMOTE_PRESENCE_TIMEOUT_MS,
} from '../src/constants.js';
import {
  setAgentRemovalCallback,
  startRemotePresenceCheck,
  startStaleExternalAgentCheck,
} from '../src/fileWatcher.js';
import type { AgentState } from '../src/types.js';

let tmpDir: string;
let timer: ReturnType<typeof setInterval> | undefined;
/** Removal runs through the module's removal callback, not by deleting from
 *  the store directly, so that is what these tests observe. */
let removed: number[];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-stale-test-'));
  removed = [];
  setAgentRemovalCallback((id: number) => removed.push(id));
  vi.useFakeTimers();
});

afterEach(() => {
  if (timer) clearInterval(timer);
  timer = undefined;
  setAgentRemovalCallback(null);
  vi.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeAgent(overrides: Partial<AgentState>): AgentState {
  return {
    id: 1,
    sessionId: 'sess',
    terminalRef: undefined,
    isExternal: true,
    projectDir: '/projects/test',
    jsonlFile: '',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    hookDelivered: false,
    lastDataAt: Date.now(),
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    contextTokens: 0,
    maxContextTokens: 200_000,
    ...overrides,
  } as AgentState;
}

/**
 * The stale check despawns an external agent whose transcript has been deleted.
 * Some agents have no transcript at all -- hooks-only providers, and teammates
 * reporting from another machine -- and the rule simply does not apply to them.
 */
describe('startStaleExternalAgentCheck', () => {
  const HOOKS_OFF = { current: false };

  function run(store: AgentStateStore): void {
    timer = startStaleExternalAgentCheck(store, new Set(), HOOKS_OFF);
    // Exactly one tick: the check is idempotent, but a second sweep would
    // report the same agent twice and make these assertions about counts lie.
    vi.advanceTimersByTime(EXTERNAL_STALE_CHECK_INTERVAL_MS);
  }

  it('removes an external agent whose transcript is gone', () => {
    const store = new AgentStateStore();
    store.set(1, makeAgent({ id: 1, jsonlFile: path.join(tmpDir, 'deleted.jsonl') }));
    run(store);
    expect(removed).toEqual([1]);
  });

  it('keeps an external agent whose transcript is still on disk', () => {
    const file = path.join(tmpDir, 'alive.jsonl');
    fs.writeFileSync(file, '');
    const store = new AgentStateStore();
    store.set(1, makeAgent({ id: 1, jsonlFile: file }));
    run(store);
    expect(removed).toEqual([]);
  });

  it('keeps a transcript-less agent instead of despawning it every tick', () => {
    // statSync('') throws, which reads as "file deleted" -- so without an
    // explicit guard a teammate's character vanishes seconds after arriving.
    const store = new AgentStateStore();
    store.set(1, makeAgent({ id: 1, jsonlFile: '', hooksOnly: true, remoteUser: 'sanne' }));
    run(store);
    expect(removed).toEqual([]);
  });

  it('does nothing at all while hooks are active', () => {
    const store = new AgentStateStore();
    store.set(1, makeAgent({ id: 1, jsonlFile: path.join(tmpDir, 'deleted.jsonl') }));
    timer = startStaleExternalAgentCheck(store, new Set(), { current: true });
    vi.advanceTimersByTime(EXTERNAL_STALE_CHECK_INTERVAL_MS);
    expect(removed).toEqual([]);
  });
});

/**
 * Teammates have no transcript to judge and no process on their machine that
 * could beat, so silence is the only liveness signal the office ever gets.
 */
describe('startRemotePresenceCheck', () => {
  function sweep(store: AgentStateStore): void {
    timer = startRemotePresenceCheck(store);
    vi.advanceTimersByTime(REMOTE_PRESENCE_CHECK_INTERVAL_MS);
  }

  it('despawns a teammate who has gone silent past the timeout', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      makeAgent({
        id: 1,
        remoteUser: 'sanne',
        hooksOnly: true,
        lastDataAt: Date.now() - REMOTE_PRESENCE_TIMEOUT_MS - 1,
      }),
    );
    sweep(store);
    expect(removed).toEqual([1]);
  });

  it('leaves a teammate alone while they are still reporting', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      makeAgent({ id: 1, remoteUser: 'sanne', hooksOnly: true, lastDataAt: Date.now() }),
    );
    sweep(store);
    expect(removed).toEqual([]);
  });

  it('leaves a teammate alone right up to the timeout', () => {
    // An off-by-one here evicts people a whole sweep early, so the boundary is
    // worth pinning rather than assuming. Note the sweep fires one interval
    // from now and the fake clock moves with it, so the agent must start that
    // much further inside the window to still be inside it when judged.
    const store = new AgentStateStore();
    const ageAtSweep = REMOTE_PRESENCE_TIMEOUT_MS - 1_000;
    store.set(
      1,
      makeAgent({
        id: 1,
        remoteUser: 'sanne',
        hooksOnly: true,
        lastDataAt: Date.now() - (ageAtSweep - REMOTE_PRESENCE_CHECK_INTERVAL_MS),
      }),
    );
    sweep(store);
    expect(removed).toEqual([]);
  });

  it('never touches local agents, however long they have been quiet', () => {
    // A local agent that is merely idle is still visibly present at their desk;
    // only the stale-transcript rule may remove one.
    const store = new AgentStateStore();
    store.set(1, makeAgent({ id: 1, jsonlFile: '/tmp/local.jsonl', lastDataAt: 0 }));
    store.set(2, makeAgent({ id: 2, hooksOnly: true, lastDataAt: 0 }));
    sweep(store);
    expect(removed).toEqual([]);
  });
});
