import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEAM_EVENT_USER_FIELD, TEAM_USER_HEADER } from '../src/constants.js';

// Isolated temp HOME: starting a server writes ~/.pixel-agents/{server.json,
// servers/,team-host-token}.
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { PixelAgentsServer } = await import('../src/server.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');

/**
 * The hook ingress route is the one door a teammate's machine can knock on.
 * These tests pin WHO gets through it and WHAT the runtime is told about them,
 * because both answers are load-bearing: the team token must not be a way into
 * the privileged surface, and an event that fails to identify its sender would
 * be processed as though it described a session on this very disk.
 */
describe('team hook ingress', () => {
  let server: InstanceType<typeof PixelAgentsServer>;
  let received: Record<string, unknown>[];
  let port: number;
  let serverToken: string;
  let teamToken: string;

  beforeEach(async () => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-team-ingress-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
    received = [];
    server = new PixelAgentsServer();
    server.onHookEvent((_providerId, event) => {
      received.push(event);
    });
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    port = config.port;
    serverToken = config.token;
    teamToken = server.getTeamHostToken()!;
  });

  afterEach(() => {
    server?.stop();
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  function post(
    token: string,
    headers: Record<string, string> = {},
    body: Record<string, unknown> = { hook_event_name: 'Stop', session_id: 'sess-1' },
  ): Promise<Response> {
    return fetch(`http://127.0.0.1:${port.toString()}/api/hooks/claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  it('issues a team token that is not the server token', () => {
    // If these were ever the same value, handing a colleague the join command
    // would hand them the credential that authorizes editing this machine's
    // ~/.claude/settings.json over /ws.
    expect(teamToken).toBeTruthy();
    expect(teamToken).not.toBe(serverToken);
  });

  it('accepts the server token with no user header, and marks the event local', async () => {
    const res = await post(serverToken);
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]![TEAM_EVENT_USER_FIELD]).toBeUndefined();
  });

  it('accepts the team token when it identifies its sender, and stamps the label', async () => {
    const res = await post(teamToken, { [TEAM_USER_HEADER]: 'sanne' });
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]![TEAM_EVENT_USER_FIELD]).toBe('sanne');
  });

  it('refuses the team token when it does not say who is reporting', async () => {
    // Anonymous ingress would be adopted as one of the host's own sessions and
    // send the runtime looking for a transcript on the wrong machine.
    const res = await post(teamToken);
    expect(res.status).toBe(400);
    expect(received).toHaveLength(0);
  });

  it('refuses an unknown token even when it names a user', async () => {
    const res = await post('not-a-real-token', { [TEAM_USER_HEADER]: 'mallory' });
    expect(res.status).toBe(401);
    expect(received).toHaveLength(0);
  });

  it('sanitizes a hostile label before it reaches the runtime', async () => {
    const res = await post(teamToken, { [TEAM_USER_HEADER]: `bad${'x'.repeat(200)}` });
    expect(res.status).toBe(200);
    expect(received[0]![TEAM_EVENT_USER_FIELD]).toHaveLength(32);
  });

  it('keeps the team token stable across a restart, so nobody is silently unjoined', async () => {
    server.stop();
    const second = new PixelAgentsServer();
    await second.start({ embedded: false, store: new AgentStateStore() });
    expect(second.getTeamHostToken()).toBe(teamToken);
    second.stop();
  });
});
