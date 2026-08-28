import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { EXTERNAL_STALE_CHECK_INTERVAL_MS } from '../src/constants.js';
import { setAgentRemovalCallback, startStaleExternalAgentCheck } from '../src/fileWatcher.js';
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
