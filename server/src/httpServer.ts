import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { promises as fs } from 'fs';
import * as path from 'path';

import { displayNameFor } from './activityMask.js';
import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type {
  AssetCache,
  ReloadAssetsSideEffect,
  SetHooksEnabledSideEffect,
} from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import {
  BROADCAST_ORIGIN_FIELD,
  HOOK_API_PREFIX,
  MAX_HOOK_BODY_SIZE,
  TEAM_EVENT_USER_FIELD,
  TEAM_USER_HEADER,
  WS_CLOSE_FORBIDDEN_ORIGIN,
  WS_CLOSE_UNAUTHORIZED,
} from './constants.js';
import { hostLabel } from './hostLabel.js';
import { joinPageHtml } from './joinPage.js';
import { CLAUDE_HOOK_SCRIPT_NAME as CLAUDE_HOOK_SCRIPT_FILE } from './providers/hook/claude/constants.js';
import { sanitizeUserLabel } from './teamConfig.js';

/** Name of the joiner bundle inside dist/. */
const JOINER_FILE = 'join.js';
import type { AgentState } from './types.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** true = VS Code embedded mode (ephemeral port, no static, quiet logging) */
  embedded: boolean;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for hook and WebSocket endpoints */
  token: string;
  /** Lower-privilege token accepted ONLY on the hook route, for teammates
   *  reporting agents into a shared office. Omitted = no team ingress. */
  teamToken?: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Shared agent lifecycle core (for toggle side effects + standalone restore). Optional in embedded mode. */
  runtime?: AgentRuntime;
  /** Path to SPA dist directory for static serving (standalone only) */
  staticDir?: string;
  /** dist/ root, so the office can hand out the joiner and the hook script it
   *  was built with. Omitted = the joining routes are not registered. */
  distRoot?: string;
  /** Cached assets loaded at startup (standalone only) */
  assetCache?: AssetCache;
  /** Callback when a hook event is received */
  onHookEvent?: (providerId: string, event: Record<string, unknown>) => void;
  /** Invoked when setHooksEnabled is toggled via WebSocket. Standalone installs/uninstalls hooks here. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** Invoked when an external asset directory is added/removed. Standalone reloads + re-broadcasts assets here. */
  onReloadAssets?: ReloadAssetsSideEffect;
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

/**
 * Create a Fastify server with hook endpoint, health check, and WebSocket support.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({
    logger: !options.embedded,
    bodyLimit: MAX_HOOK_BODY_SIZE,
  });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Static SPA serving (standalone mode only)
  if (!options.embedded && options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  registerHealthRoute(app);
  registerJoinRoutes(app, options);
  registerHookRoute(app, options);
  registerWebSocketRoute(app, options);

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));
}

// ── Hook Events ────────────────────────────────────────────────

function registerHookRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{
    Params: { providerId: string };
    Body: Record<string, unknown>;
  }>(
    `${HOOK_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token, options.teamToken),
      schema: {
        params: {
          type: 'object',
          properties: {
            providerId: { type: 'string', pattern: '^[a-z0-9-]+$' },
          },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const event = request.body;

      // A hook POST that names a user came from another machine's Claude (the
      // hook script labels only its team deliveries, never its loopback ones).
      // Stamp the label on the event so the runtime knows not to go looking for
      // a transcript file that exists on someone else's disk. The label is
      // attacker-controlled in the same sense the whole body is -- the bearer
      // token is the actual gate -- so it is sanitized before it can reach a
      // log line or the office UI.
      const rawUser = request.headers[TEAM_USER_HEADER];
      const user = typeof rawUser === 'string' ? sanitizeUserLabel(rawUser) : '';
      if (user) event[TEAM_EVENT_USER_FIELD] = user;

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
      }

      reply.send('ok');
    },
  );
}

// ── Joining ────────────────────────────────────────────────────

/**
 * The three things a colleague's machine needs, served by the office itself.
 *
 * These routes are deliberately UNAUTHENTICATED, and reachability is the whole
 * gate: an office bound to loopback can only be joined from the machine it runs
 * on, and one bound to the network can be joined by anyone who can already open
 * its page. That is the trade a one-command join is made of. It also means the
 * team token is handed to anyone who asks -- which is exactly why the team
 * token exists separately from the server token, and cannot approve anything.
 *
 * Serving the hook script from here is what ends the "everybody re-pull after
 * an update" problem: members fetch the office's current script, not a copy
 * they cloned once.
 */
function registerJoinRoutes(app: FastifyInstance, options: HttpServerOptions): void {
  const { distRoot, teamToken } = options;
  if (!distRoot || !teamToken) return;

  /** The address this caller actually reached us on. The server cannot know it
   *  any other way -- it may be behind a proxy, on any of several interfaces,
   *  or addressed by a name that resolves here. Host is caller-supplied, but it
   *  only ever shapes a URL echoed back to that same caller. */
  const officeUrl = (request: FastifyRequest): string => {
    const host = request.headers.host ?? '127.0.0.1';
    return `http://${host}`;
  };

  app.get('/api/hook-script', async (_request, reply) => {
    const file = path.join(distRoot, 'hooks', CLAUDE_HOOK_SCRIPT_FILE);
    try {
      const body = await fs.readFile(file, 'utf-8');
      reply.type('text/javascript; charset=utf-8').send(body);
    } catch {
      reply.code(503).send('hook script not built');
    }
  });

  app.get('/api/join.js', async (_request, reply) => {
    const file = path.join(distRoot, JOINER_FILE);
    try {
      const body = await fs.readFile(file, 'utf-8');
      reply.type('text/javascript; charset=utf-8').send(body);
    } catch {
      reply.code(503).send('joiner not built');
    }
  });

  app.get('/join.sh', async (request, reply) => {
    const url = officeUrl(request);
    reply
      .type('text/plain; charset=utf-8')
      .send(
        [
          '#!/bin/sh',
          '# Join this Pixel Agents office. Downloads the joiner, runs it, cleans up.',
          'set -e',
          'TMP="$(mktemp -t pixel-agents-join)"',
          `curl -fsSL "${url}/api/join.js" -o "$TMP"`,
          `node "$TMP" "${url}/?token=${teamToken}" "$@"`,
          'rm -f "$TMP"',
          '',
        ].join('\n'),
      );
  });

  app.get('/join', async (request, reply) => {
    reply.type('text/html; charset=utf-8').send(joinPageHtml(officeUrl(request), teamToken));
  });
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    // CONNECTION gate. Embedded (VS Code) requires the Bearer token. Standalone
    // requires a same-origin handshake instead (isAllowedWebSocketOrigin), so a
    // non-browser local client with no Origin can still watch the office. What
    // may be DONE over an accepted connection is a separate question, decided
    // below.
    if (options.embedded) {
      if (!timingSafeStringEqual(request.headers.authorization ?? '', `Bearer ${options.token}`)) {
        socket.close(WS_CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }
    } else if (!isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)) {
      socket.close(WS_CLOSE_FORBIDDEN_ORIGIN, 'forbidden origin');
      return;
    }

    // Both modes prove privilege with the SAME out-of-band secret, differently
    // carried: embedded sends the Bearer token it was handed in-process;
    // standalone sends the `?token=` the CLI printed in the local URL and the
    // SPA forwarded on this handshake. Nothing about a network POSITION is
    // consulted, because every position is reproducible by a forwarder.
    const privileged = options.embedded || standaloneTokenValid(request.url, options.token);

    const { store } = options;

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      safeSend(socket, {
        type: 'agentCreated',
        id,
        folderName: displayNameFor(agent.remoteUser, hostLabel()),
        isExternal: agent.isExternal || undefined,
        isTeammate: agent.leadAgentId !== undefined || undefined,
        teammateName: agent.agentName,
        parentAgentId: agent.leadAgentId,
        teamName: agent.teamName,
        hooksOnly: agent.hooksOnly || undefined,
        palette: agent.palette,
        hueShift: agent.hueShift,
      });
    };

    const onAgentRemoved = (id: number) => {
      safeSend(socket, { type: 'agentClosed', id });
    };

    // Identifies this socket for the duration of the connection, so a change
    // it made comes back to everyone else and not to itself.
    const connectionId = crypto.randomUUID();

    const onBroadcast = (message: Record<string, unknown>) => {
      const origin = message[BROADCAST_ORIGIN_FIELD];
      if (typeof origin === 'string') {
        if (origin === connectionId) return; // our own echo
        // The marker is server-side bookkeeping; the wire contract knows
        // nothing about it, so it never leaves this function.
        const { [BROADCAST_ORIGIN_FIELD]: _origin, ...rest } = message;
        safeSend(socket, rest);
        return;
      }
      safeSend(socket, message);
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (!options.embedded && msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          store,
          runtime: options.runtime,
          cache: options.assetCache ?? null,
          onSetHooksEnabled: options.onSetHooksEnabled,
          onReloadAssets: options.onReloadAssets,
          privileged,
          connectionId,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
    });
  });
}

/**
 * Standalone `/ws` CONNECTION gate: is this handshake same-origin?
 *
 * WebSocket connects are NOT subject to CORS, so without this any web page the
 * user happens to visit could open a socket to 127.0.0.1 and start talking.
 * Comparing Origin's host against the request's own Host header makes the check
 * same-origin by construction — it tracks whatever --host/--port the server was
 * bound to with zero configuration, and treats `localhost` and `127.0.0.1`
 * correctly (a browser derives both headers from the URL that loaded the SPA).
 *
 * A missing Origin still connects: non-browser local clients send none, and the
 * standalone server's read surface is deliberately open to whatever address it
 * was told to bind (`--host 0.0.0.0` exposes the SPA to the LAN by design).
 *
 * This gate is NOT sufficient for privileged actions and never was. Both header
 * values are attacker-supplied, so a DNS-rebound page (`evil.com` → 127.0.0.1)
 * sends `Origin: http://evil.com:PORT` AND `Host: evil.com:PORT` and passes
 * equality. See standaloneTokenValid for what actually guards consent.
 */
export function isAllowedWebSocketOrigin(
  origin: string | undefined,
  host: string | undefined,
): boolean {
  if (origin === undefined || origin === '') return true;
  try {
    return new URL(origin).host === host;
  } catch {
    // An unparseable Origin is not a same-origin browser request.
    return false;
  }
}

/**
 * Whether this socket may send PRIVILEGED messages — the ones that reach
 * outside `~/.pixel-agents/`. Today that is `setHooksEnabled`, which grants
 * durable, machine-wide consent to modify `~/.claude/settings.json` and
 * installs (or removes) a 12-event hook set.
 *
 * The handshake must carry the server token in its `?token=` query. That token
 * is minted at startup (server.ts), printed by the CLI inside the LOCAL url it
 * emits to the operator's terminal, and forwarded by the SPA loaded from that
 * url (webview-ui/src/transport/index.ts). It is the Jupyter model.
 *
 * Why a secret rather than a network position: EVERY position is reproducible.
 * The predecessor of this function required a loopback peer address AND a
 * loopback `Host`, on the theory that only a real local browser satisfies both.
 * A dumb TCP forwarder bound to the LAN, piping bytes verbatim to 127.0.0.1,
 * presents the server exactly what the SPA presents — `remoteAddress` is
 * 127.0.0.1 because the forwarder terminated the hop there, and `Host` is
 * whatever the remote client typed. Reproduced against the real `dist/cli.js`:
 * a client on another machine acquired consent and a 12-event install. Peer
 * address and Host/Origin are all carried BY the channel a proxy speaks, so the
 * gate must ride something the channel never carries — an out-of-band secret
 * the operator's own URL delivers and the forwarded attacker never sees.
 *
 * A tokenless client is not locked out of Pixel Agents — it connects and
 * watches the office exactly as before (the connection gate,
 * isAllowedWebSocketOrigin, is separate and unchanged). It simply cannot
 * approve a change to a file in someone's home directory.
 */
function standaloneTokenValid(url: string | undefined, expected: string): boolean {
  // Defensive: an empty configured token would otherwise privilege every
  // handshake that omits the query (both sides compare equal as '').
  if (!expected) return false;
  let provided: string;
  try {
    // Parsed against a dummy base because `request.url` is path-relative. Read
    // from the raw url rather than a framework-parsed query so the gate does
    // not depend on @fastify/websocket populating one on the upgrade request.
    provided = new URL(url ?? '', 'http://localhost').searchParams.get('token') ?? '';
  } catch {
    return false;
  }
  return timingSafeStringEqual(provided, expected);
}

// ── Auth Helper ────────────────────────────────────────────────

/** Constant-time string compare, length-guarded (timingSafeEqual throws on a
 *  length mismatch). One implementation for all three token comparisons. */
function timingSafeStringEqual(actual: string, expected: string): boolean {
  const actualBuf = Buffer.from(actual);
  const expectedBuf = Buffer.from(expected);
  return actualBuf.length === expectedBuf.length && crypto.timingSafeEqual(actualBuf, expectedBuf);
}

/**
 * Gate the hook route on either the server token or, when this server hosts a
 * shared office, the team token.
 *
 * The two are not interchangeable anywhere else: the server token also proves
 * privilege on `/ws` (where it authorizes editing the host's Claude settings),
 * while the team token is accepted here and nowhere else. A teammate is
 * additionally required to SAY who they are -- without the user header the
 * runtime would treat their session as one of the host's own and go looking
 * for a transcript file that is on another machine.
 */
function bearerAuth(expectedToken: string, teamToken?: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const presented = request.headers.authorization ?? '';
    if (timingSafeStringEqual(presented, `Bearer ${expectedToken}`)) return;
    if (teamToken && timingSafeStringEqual(presented, `Bearer ${teamToken}`)) {
      if (typeof request.headers[TEAM_USER_HEADER] === 'string') return;
      reply.code(400).send('team token requires a user header');
      return;
    }
    reply.code(401).send('unauthorized');
  };
}

// ── Utilities ──────────────────────────────────────────────────

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
