import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  MAX_PORT,
  MIN_PORT,
  SERVER_JSON_DIR,
  SERVERS_DIR,
  TEAM_HOST_TOKEN_NAME,
  TEAM_JSON_NAME,
  TEAM_USER_LABEL_MAX,
} from './constants.js';

/**
 * A remote Pixel Agents server this machine reports to, so that several
 * people's agents appear in one shared office.
 *
 * This is deliberately NOT a ServerConfig. The local registry under
 * ~/.pixel-agents/servers/ identifies a server by `pid` and prunes entries
 * whose process is dead -- a liveness test that only means anything on the
 * machine that owns the PID. A team server runs somewhere else, so it carries
 * a reachable address instead and is never PID-gated: an unreachable one is
 * discovered by the POST failing, which the hook already tolerates silently.
 */
export interface TeamServer {
  /** 'http' or 'https'. */
  protocol: 'http' | 'https';
  /** Hostname or IP of the team server. */
  host: string;
  /** TCP port of the team server. */
  port: number;
  /** Bearer token issued by that server. */
  token: string;
  /** Display label for this machine's agents in the shared office. */
  user: string;
}

/** On-disk shape of ~/.pixel-agents/team.json. An array so one machine can
 *  report to several offices (e.g. a team office and a personal one). */
export type TeamConfigFile = TeamServer[];

/** Resolved lazily, never at module load: the home directory is test-mocked and
 *  can legitimately change between calls, and a module-level path.join makes
 *  merely IMPORTING this file fail when os is stubbed. */
export function teamJsonPath(): string {
  return path.join(os.homedir(), SERVER_JSON_DIR, TEAM_JSON_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reduce an arbitrary label to something safe to render as a character name.
 * Control characters are stripped rather than escaped: the label reaches the
 * office UI and a server log, and neither should have to defend itself against
 * a newline or an ANSI escape smuggled in through a hook header.
 */
export function sanitizeUserLabel(raw: string): string {
  const stripped = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return stripped.slice(0, TEAM_USER_LABEL_MAX);
}

/** Validate one entry before we POST session metadata to the address it names. */
export function isTeamServer(value: unknown): value is TeamServer {
  if (!isRecord(value)) return false;
  return (
    (value.protocol === 'http' || value.protocol === 'https') &&
    typeof value.host === 'string' &&
    value.host.length > 0 &&
    Number.isSafeInteger(value.port) &&
    (value.port as number) >= MIN_PORT &&
    (value.port as number) <= MAX_PORT &&
    typeof value.token === 'string' &&
    value.token.length > 0 &&
    typeof value.user === 'string' &&
    value.user.length > 0
  );
}

/**
 * Parse a `--join` URL into a TeamServer. Accepts the exact URL the server
 * prints (`http://host:3100/?token=...`), so joining is a copy-paste, with an
 * explicit `token` argument as the alternative for a URL without the query.
 * Returns a reason string instead of throwing -- the CLI turns it into a
 * one-line error and every caller has to handle a bad address anyway.
 */
export function parseJoinUrl(
  raw: string,
  user: string,
  explicitToken?: string,
): { ok: true; server: TeamServer } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `not a valid URL: "${raw}"` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `unsupported protocol "${url.protocol}" (expected http or https)` };
  }
  const token = explicitToken ?? url.searchParams.get('token') ?? '';
  if (!token) {
    return {
      ok: false,
      reason: 'no token found: pass --token, or use the full URL the team server printed',
    };
  }
  const defaultPort = url.protocol === 'https:' ? 443 : 80;
  const port = url.port ? Number(url.port) : defaultPort;
  const label = sanitizeUserLabel(user);
  if (!label) return { ok: false, reason: 'user label is empty after sanitizing' };

  const server: TeamServer = {
    protocol: url.protocol === 'https:' ? 'https' : 'http',
    host: url.hostname,
    port,
    token,
    user: label,
  };
  return isTeamServer(server)
    ? { ok: true, server }
    : { ok: false, reason: 'address did not produce a usable server entry' };
}

/**
 * Read every configured team server. Malformed entries are skipped rather than
 * failing the read: this runs inside the hook script on every Claude event, and
 * one bad hand-edited entry must never cost the user their local office.
 */
export function readTeamServers(filePath: string = teamJsonPath()): TeamServer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isTeamServer);
}

/** Persist the team server list, creating ~/.pixel-agents/ if needed. */
export function writeTeamServers(servers: TeamServer[], filePath: string = teamJsonPath()): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(servers, null, 2)}\n`, 'utf-8');
}

/** Identify an entry by address; a machine reports to one office per address. */
export function sameAddress(a: TeamServer, b: TeamServer): boolean {
  return a.protocol === b.protocol && a.host === b.host && a.port === b.port;
}

/** File holding this machine's team-host token. Separate from the server token
 *  in ~/.pixel-agents/servers/, and deliberately STABLE across restarts: a
 *  colleague joins once, and a host restart must not silently unjoin everyone. */
export function teamHostTokenPath(): string {
  return path.join(os.homedir(), SERVER_JSON_DIR, TEAM_HOST_TOKEN_NAME);
}

/**
 * The token colleagues use to report agents into this office.
 *
 * It exists so that hosting an office does not mean handing out the server
 * token. That one is a privileged capability: presented on the `/ws` query it
 * authorizes `setHooksEnabled`, which edits the HOST's ~/.claude/settings.json.
 * A teammate needs exactly one power -- POST a hook event -- and the hook route
 * is the only route that consults this token, so accepting it there grants that
 * one power and nothing else.
 *
 * Created on first use and reused forever after; callers must treat a returned
 * token as a secret.
 */
export function readOrCreateTeamHostToken(
  filePath: string = teamHostTokenPath(),
  generate: () => string = () => crypto.randomUUID(),
): string {
  try {
    const existing = fs.readFileSync(filePath, 'utf-8').trim();
    if (existing.length > 0) return existing;
  } catch {
    /* not created yet -- fall through and mint one */
  }
  const token = generate();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // 0600: the whole point of this file is that it is a secret.
  fs.writeFileSync(filePath, `${token}\n`, { encoding: 'utf-8', mode: 0o600 });
  return token;
}

/**
 * True when this address is an office running on THIS machine.
 *
 * Joining your own office is a natural mistake -- the instructions say
 * "colleagues join", and the host also wants to see themselves -- but it makes
 * every event arrive twice at the same server: once unlabelled over loopback
 * from the local registry, once labelled as a teammate. The pending-session
 * record is keyed by session id and last-write-wins, so which of the two
 * decides your fate is a race, and the labelled path additionally gives up
 * transcript reading for a session whose transcript is right here.
 *
 * Detection is deliberately conservative: a loopback name, or one of this
 * machine's own interface addresses, combined with a port some local server has
 * registered. A hostname that resolves here through DNS is not caught, which is
 * why the caller treats a negative as "probably fine" rather than proof.
 */
export function isOwnOffice(server: TeamServer, localPorts: number[]): boolean {
  if (!localPorts.includes(server.port)) return false;
  const host = server.host.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    return true;
  }
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.address.toLowerCase() === host) return true;
    }
  }
  return false;
}

/** Ports of Pixel Agents servers registered on this machine, live or not.
 *  Reading the registry rather than probing: a stale entry costs a false
 *  positive on a port nobody is using, which is a far better failure than
 *  opening sockets from a config command. */
export function localServerPorts(): number[] {
  const dir = path.join(os.homedir(), SERVER_JSON_DIR, SERVERS_DIR);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const ports: number[] = [];
  for (const file of files) {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as unknown;
      if (isRecord(entry) && Number.isSafeInteger(entry.port)) ports.push(entry.port as number);
    } catch {
      /* a malformed registry entry simply contributes no port */
    }
  }
  return ports;
}
