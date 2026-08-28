import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';

import {
  HOOK_API_PREFIX,
  SERVER_JSON_DIR,
  SERVER_JSON_NAME,
  SERVERS_DIR,
  TEAM_POST_TIMEOUT_MS,
  TEAM_USER_HEADER,
} from '../../../../constants.js';
import type { ServerConfig, ServerTarget } from '../../../../serverConfig.js';
import { isServerConfig, isServerTarget } from '../../../../serverConfig.js';
import type { TeamServer } from '../../../../teamConfig.js';
import { readTeamServers } from '../../../../teamConfig.js';

const SERVER_JSON = path.join(os.homedir(), SERVER_JSON_DIR, SERVER_JSON_NAME);
const SERVERS_REGISTRY_DIR = path.join(os.homedir(), SERVER_JSON_DIR, SERVERS_DIR);

/**
 * CI / e2e diagnostic: when PIXEL_AGENTS_DEBUG_LOG is set, record the hook
 * script's outcome at every exit point. The hook delivery chain (spawn
 * claude-hook.js -> read the registry -> POST to every live server) is
 * otherwise 100% silent: every failure path resolves quietly, so a dropped
 * hook is invisible in CI. Logging here lets a failing run show exactly
 * where delivery dies (bad-stdin, no-server-json, per-server POST
 * error/timeout/status). Zero cost when the env var is unset.
 */
// Env var is the primary source, but it doesn't reliably reach this spawned
// process across platforms (macOS VS Code terminal profiles with
// inheritEnv:false, etc.). After reading the registry we fall back to a
// live server's `debugLog` field, which the server populated from the same
// env var.
let debugLogPath = process.env['PIXEL_AGENTS_DEBUG_LOG'];
function hookDebug(line: string): void {
  if (!debugLogPath) return;
  try {
    fs.appendFileSync(debugLogPath, `${new Date().toISOString()} HOOKSCRIPT ${line}\n`);
  } catch {
    /* never let diagnostics break the hook */
  }
}

/** True if a process with this PID is alive. Best-effort: a false positive on
 *  PID reuse just costs one extra, harmless, failed POST -- never a crash. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Enumerate every live registry entry under ~/.pixel-agents/servers/, so the
 * event can fan out to each running server (VS Code embedded + a standalone
 * `npx pixel-agents`, or several of either, all at once). Entries whose owning
 * PID is no longer alive are skipped (the owning server prunes its own stale
 * file on next start; this script only needs to not POST to it). Returns an
 * empty array when the directory is absent/empty/unreadable -- the caller
 * falls back to the legacy single-target server.json (forward-compat with a
 * server that predates the registry).
 */
function readRegistry(): ServerConfig[] {
  let files: string[];
  try {
    files = fs.readdirSync(SERVERS_REGISTRY_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  const live: ServerConfig[] = [];
  for (const file of files) {
    const filePath = path.join(SERVERS_REGISTRY_DIR, file);
    try {
      const entry = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
      if (!isServerConfig(entry)) {
        hookDebug(`registry-skip reason=malformed file=${file} err=invalid-server-config`);
        continue;
      }
      if (isProcessAlive(entry.pid)) {
        live.push(entry);
      } else {
        hookDebug(`registry-skip reason=dead-pid file=${file} pid=${entry.pid}`);
      }
    } catch (e) {
      hookDebug(
        `registry-skip reason=malformed file=${file} err=${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return live;
}

/**
 * One delivery destination, unified across a locally-registered server and a
 * remote team server so the fan-out loop does not have to care which is which.
 */
interface PostTarget {
  protocol: 'http' | 'https';
  host: string;
  port: number;
  token: string;
  /** Set only for a team server: the label this machine's agents wear in the
   *  shared office. Its ABSENCE is what marks a delivery as local -- the
   *  receiving server treats an event with no user header as its own. */
  user?: string;
}

/** A server registered on this machine is always reached over loopback. */
function localTarget(server: ServerTarget): PostTarget {
  return { protocol: 'http', host: '127.0.0.1', port: server.port, token: server.token };
}

/** A team server carries its own address; the shape already matches. */
function teamTarget(server: TeamServer): PostTarget {
  return {
    protocol: server.protocol,
    host: server.host,
    port: server.port,
    token: server.token,
    user: server.user,
  };
}

/**
 * POST one hook event to one server. Best-effort: every failure path (bad
 * connection, timeout, non-2xx status) resolves quietly -- a dropped delivery
 * to one server must never affect delivery to any other server, nor the
 * script's exit code. That tolerance is what lets a team server be offline,
 * asleep, or on the wrong network without disturbing the local office.
 */
function postToServer(
  server: PostTarget,
  body: string,
  eventName: string,
  sid: string,
): Promise<void> {
  const where = server.user ? `${server.host}:${server.port}` : `port=${server.port}`;
  hookDebug(`POST event=${eventName} sid=${sid} ${where}`);
  return new Promise((resolve) => {
    try {
      const transport = server.protocol === 'https' ? https : http;
      const headers: Record<string, string | number> = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${server.token}`,
      };
      // Only a remote delivery is labelled. A team server uses the presence of
      // this header to decide the event describes someone else's machine, and
      // therefore that it must not go looking for a local transcript file.
      if (server.user) headers[TEAM_USER_HEADER] = server.user;
      const req = transport.request(
        {
          hostname: server.host,
          port: server.port,
          path: `${HOOK_API_PREFIX}/claude`,
          method: 'POST',
          headers,
          // A LAN or WAN hop deserves more patience than loopback, but the
          // hook still must not stall the agent it is reporting on.
          timeout: server.user ? TEAM_POST_TIMEOUT_MS : 2000,
        },
        (res) => {
          hookDebug(
            `POST-done event=${eventName} sid=${sid} status=${res.statusCode} port=${server.port}`,
          );
          res.resume();
          resolve();
        },
      );
      req.on('error', (err) => {
        hookDebug(
          `POST-error event=${eventName} sid=${sid} port=${server.port} err=${err.message}`,
        );
        resolve();
      });
      req.on('timeout', () => {
        hookDebug(`POST-timeout event=${eventName} sid=${sid} port=${server.port}`);
        req.destroy();
        resolve();
      });
      req.end(body);
    } catch (err) {
      hookDebug(
        `POST-error event=${eventName} sid=${sid} port=${server.port} err=${err instanceof Error ? err.message : String(err)}`,
      );
      resolve();
    }
  });
}

async function main(): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(input);
  } catch {
    hookDebug('exit reason=bad-stdin');
    process.exit(0);
  }

  const eventName = (data.hook_event_name as string | undefined) ?? '?';
  const sid = (data.session_id as string | undefined)?.slice(0, 8) ?? '?';

  // Multi-server fan-out (D4): deliver to every live server in the registry.
  // Falls back to the single legacy server.json when the registry has no live
  // entries -- e.g. a server on disk that predates the registry (A1/A2).
  let servers: ServerTarget[] = readRegistry();
  const teamServers = readTeamServers();
  if (servers.length === 0) {
    try {
      const legacy = JSON.parse(fs.readFileSync(SERVER_JSON, 'utf-8')) as unknown;
      if (!isServerTarget(legacy)) {
        throw new Error('invalid legacy server config');
      }
      servers = [legacy];
    } catch (e) {
      // Only fatal when there is nowhere at all to report. Having joined a team
      // office is a complete reason to run this hook: someone who watches the
      // shared office from another machine runs no local server of their own.
      if (teamServers.length === 0) {
        hookDebug(
          `exit reason=no-server-json event=${eventName} sid=${sid} path=${SERVER_JSON} err=${e instanceof Error ? e.message : String(e)}`,
        );
        process.exit(0);
      }
    }
  }

  // Adopt the first live server's debug-log path if the env var didn't reach
  // us (diagnostic-only; harmless if more than one server has it set).
  if (!debugLogPath) {
    const withDebugLog = servers.find((s) => s.debugLog);
    if (withDebugLog?.debugLog) debugLogPath = withDebugLog.debugLog;
  }

  const targets: PostTarget[] = [...servers.map(localTarget), ...teamServers.map(teamTarget)];
  hookDebug(
    `fan-out event=${eventName} sid=${sid} local=${servers.length} team=${teamServers.length}`,
  );

  // One payload for every destination. The office decides what is shown --
  // masking lives there now, so a machine on an older build cannot make the
  // office leak, and improving the rule does not need everyone to rebuild.
  const body = JSON.stringify(data);
  await Promise.all(targets.map((target) => postToServer(target, body, eventName, sid)));
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
