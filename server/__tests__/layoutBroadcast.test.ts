import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { PixelAgentsServer } = await import('../src/server.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');

/** Long enough for a message to cross a loopback socket, short enough that a
 *  missing broadcast fails the test rather than hanging it. */
const SETTLE_MS = 400;

interface Client {
  socket: WebSocket;
  layouts: Record<string, unknown>[];
}

function connect(port: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port.toString()}/ws`);
    const layouts: Record<string, unknown>[] = [];
    socket.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type === 'layoutLoaded') layouts.push(msg);
    });
    socket.on('open', () => resolve({ socket, layouts }));
    socket.on('error', reject);
  });
}

const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));

/**
 * One office means one layout, so a change has to reach everyone watching --
 * that is the whole difference between a shared office and several people
 * looking at their own copy. Before this, saveLayout wrote a file and told
 * nobody, and other viewers stayed stale until they reloaded.
 */
describe('layout changes reach other viewers', () => {
  let server: InstanceType<typeof PixelAgentsServer>;
  const open: WebSocket[] = [];
  let port: number;

  beforeEach(async () => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-layout-bcast-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
    server = new PixelAgentsServer();
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    port = config.port;
  });

  afterEach(() => {
    for (const s of open) s.terminate();
    open.length = 0;
    server?.stop();
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  async function twoViewers(): Promise<{ saver: Client; watcher: Client }> {
    const watcher = await connect(port);
    const saver = await connect(port);
    open.push(watcher.socket, saver.socket);
    await settle();
    // Drop the layouts both were handed during their own handshake.
    watcher.layouts.length = 0;
    saver.layouts.length = 0;
    return { saver, watcher };
  }

  const LAYOUT = { version: 1, cols: 21, rows: 22, tiles: [], furniture: [], marker: 'from-saver' };

  it('sends the new layout to the other viewer', async () => {
    const { saver, watcher } = await twoViewers();
    saver.socket.send(JSON.stringify({ type: 'saveLayout', layout: LAYOUT }));
    await settle();

    expect(watcher.layouts).toHaveLength(1);
    expect((watcher.layouts[0]!.layout as Record<string, unknown>).marker).toBe('from-saver');
  });

  it('does not echo the change back to whoever made it', async () => {
    // The saver already has this state. Re-applying it would rebuild their
    // office under them, resetting camera and selection mid-edit.
    const { saver, watcher } = await twoViewers();
    saver.socket.send(JSON.stringify({ type: 'saveLayout', layout: LAYOUT }));
    await settle();

    expect(saver.layouts).toHaveLength(0);
    expect(watcher.layouts).toHaveLength(1);
  });

  it('keeps the routing marker off the wire', async () => {
    // It is server-side bookkeeping. The AsyncAPI contract does not describe
    // it, so a client must never see it.
    const { saver, watcher } = await twoViewers();
    saver.socket.send(JSON.stringify({ type: 'saveLayout', layout: LAYOUT }));
    await settle();

    const keys = Object.keys(watcher.layouts[0]!);
    expect(keys.some((k) => k.startsWith('__origin'))).toBe(false);
    expect(keys.sort()).toEqual(['layout', 'type']);
  });
});
