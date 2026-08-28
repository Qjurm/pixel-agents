#!/usr/bin/env node

/**
 * Standalone CLI entry point: `npx pixel-agents`
 *
 * Starts the Fastify server in standalone mode with SPA serving and WebSocket.
 * Loads all assets (PNGs -> SpriteData) on startup and caches in memory.
 * Each connecting WebSocket client receives the full state on webviewReady.
 */

import * as os from 'os';
import * as path from 'path';

import { AgentRuntime } from './agentRuntime.js';
import { AgentStateStore } from './agentStateStore.js';
import {
  buildAssetCache,
  loadAllCharacters,
  loadAllFurniture,
  loadAllPets,
} from './assetReload.js';
import type { AssetCache, ReloadAssetsSideEffect } from './clientMessageHandler.js';
import {
  getHooksConsent,
  getHooksEnabled,
  grantHooksConsent,
  readConfig,
  setHooksEnabled,
} from './configPersistence.js';
import { MAX_PORT, MIN_PORT } from './constants.js';
import { FileStateAdapter } from './fileStateAdapter.js';
import { claudeProvider, copyHookScript, hookProviderById } from './providers/index.js';
import { PixelAgentsServer } from './server.js';
import {
  isOwnOffice,
  localServerPorts,
  parseJoinUrl,
  readTeamServers,
  sameAddress,
  teamJsonPath,
  writeTeamServers,
} from './teamConfig.js';

// ── Argument parsing ──────────────────────────────────────────

export interface CliArgs {
  /** Unset -> ephemeral (OS-assigned) port, so multiple standalone instances
   *  can run at once without a collision. --port picks a fixed one. */
  port?: number;
  host: string;
  /** --join <url>: report this machine's agents to a shared team office. */
  join?: string;
  /** --leave <url>: stop reporting to that office. */
  leave?: string;
  /** --as <label>: how this machine's agents are named in the shared office. */
  as?: string;
  /** --token <token>: team server token, when the --join URL carries none. */
  token?: string;
  /** --yes: accept the hook install without the interactive question. */
  yes?: boolean;
}

/** Thrown by parseArgs on an invalid --port. Kept separate from process.exit so
 *  the parsing logic stays a pure, unit-testable function -- main() is the only
 *  place that turns a bad argument into an exit code. */
export class CliArgsError extends Error {}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' || argv[i] === '-p') {
      const raw = argv[i + 1];
      if (raw === undefined) {
        throw new CliArgsError(
          `Missing value for ${argv[i]}: expected an integer between ${MIN_PORT} and ${MAX_PORT}.`,
        );
      }
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
        throw new CliArgsError(
          `Invalid --port "${raw}": must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
        );
      }
      args.port = parsed;
      i++;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      args.host = argv[i + 1];
      i++;
    } else if (argv[i] === '--join' && argv[i + 1]) {
      args.join = argv[i + 1];
      i++;
    } else if (argv[i] === '--leave' && argv[i + 1]) {
      args.leave = argv[i + 1];
      i++;
    } else if (argv[i] === '--as' && argv[i + 1]) {
      args.as = argv[i + 1];
      i++;
    } else if (argv[i] === '--token' && argv[i + 1]) {
      args.token = argv[i + 1];
      i++;
    } else if (argv[i] === '--yes' || argv[i] === '-y') {
      args.yes = true;
    } else if (argv[i] === '--help') {
      console.log(`Usage: pixel-agents [options]

Options:
  --port, -p <number>   Port to listen on (default: OS-assigned ephemeral port)
  --host <string>       Host to bind to (default: 127.0.0.1)
  --help                Show this help message

Shared office (multiplayer):
  --join <url>          Also report this machine's agents to a shared office.
                        Paste the URL that office printed, token included.
  --as <label>          Name for this machine's agents there (default: $USER)
  --token <token>       Token, when the --join URL carries none
  --yes, -y             Install the Claude hooks without asking
  --leave <url>         Stop reporting to that office

  Joining sets up everything this machine needs and exits -- it never starts a
  server. To HOST an office for your team, bind it where colleagues can reach it
  and hand them the printed URL:

    pixel-agents --host 0.0.0.0 --port 3100`);
      process.exit(0);
    }
  }
  return args;
}

// ── Hooks consent ─────────────────────────────────────────────
// First-run consent is asked IN THE APP, not here: the server sends a
// hooksConsentRequest to privileged (tokened) connections during the
// webviewReady handshake (clientMessageHandler.ts), and the browser renders
// the dialog — the same UX the VS Code webview shows. The CLI itself never
// prompts; a headless run just starts without hooks until consent is granted
// through the UI. The one exception that needs no dialog is the silent-grant
// migration below (our hooks already installed by a pre-consent version).

/**
 * Copy the bundled hook script into ~/.pixel-agents/hooks/, reporting failure.
 *
 * Callers run this BEFORE installing the settings.json entries and abort when
 * it returns false: an entry whose command points at a missing script makes
 * Claude Code spawn a dead `node` process for every event, which is strictly
 * worse than no hooks at all.
 */
function copyHookScriptOrReport(packageRoot: string, context = ''): boolean {
  if (copyHookScript(packageRoot)) return true;
  console.error(`[Pixel Agents] Hooks NOT installed${context}: hook script missing.`);
  return false;
}

// ── Main ──────────────────────────────────────────────────────

/**
 * Best guess at the address colleagues can actually reach this machine on.
 * Printing `0.0.0.0` in a join command is printing a bind target, not a
 * destination; falling back to the display host is fine when the guess fails,
 * since the operator can always correct the host by hand.
 */
function firstNonLoopbackAddress(): string | undefined {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return undefined;
}

/**
 * Apply `--join` / `--leave` to ~/.pixel-agents/team.json and report the
 * result. Exits the process non-zero on a bad address rather than starting a
 * server, so a typo in a URL can't quietly leave someone reporting nowhere.
 */
async function applyTeamMembership(args: CliArgs, packageRoot: string): Promise<void> {
  const existing = readTeamServers();

  if (args.leave) {
    const parsed = parseJoinUrl(args.leave, 'x', 'x');
    if (!parsed.ok) {
      console.error(`[Pixel Agents] --leave: ${parsed.reason}`);
      process.exit(1);
    }
    const remaining = existing.filter((entry) => !sameAddress(entry, parsed.server));
    if (remaining.length === existing.length) {
      console.log(
        `[Pixel Agents] Not a member of ${parsed.server.host}:${parsed.server.port} — nothing to leave.`,
      );
      return;
    }
    writeTeamServers(remaining);
    console.log(`[Pixel Agents] Left the office at ${parsed.server.host}:${parsed.server.port}.`);
    return;
  }

  // Default the label to the OS user: in an office of colleagues, the machine's
  // own account name is nearly always the name people already know you by.
  const label = args.as ?? process.env['USER'] ?? process.env['USERNAME'] ?? 'someone';
  const parsed = parseJoinUrl(args.join!, label, args.token);
  if (!parsed.ok) {
    console.error(`[Pixel Agents] --join: ${parsed.reason}`);
    process.exit(1);
  }
  const server = parsed.server;

  // Joining your own office is the one join that makes things worse rather than
  // better: every event then arrives twice at the same server and which copy
  // wins is a race. What the host actually wants is the tracked-project gate
  // widened, so point at that instead of at a workaround.
  if (isOwnOffice(server, localServerPorts())) {
    console.error(
      `[Pixel Agents] ${server.host}:${server.port} is an office on THIS machine — not joining.\n` +
        '               Your own agents already reach it directly. If you cannot see them,\n' +
        '               the reason is the project filter, not membership:\n' +
        '                 • turn on Settings -> Watch All Sessions, or\n' +
        '                 • start the office from the folder you work in.',
    );
    process.exit(1);
  }
  // Re-joining an address replaces that entry rather than stacking a second
  // one: a rotated token or a changed label is the common reason to re-run it.
  const next = [...existing.filter((entry) => !sameAddress(entry, server)), server];
  writeTeamServers(next);

  console.log(
    `[Pixel Agents] Joined the office at ${server.host}:${server.port} as "${server.user}".`,
  );
  console.log(`[Pixel Agents] Membership saved to ${teamJsonPath()}`);
  console.log(
    '[Pixel Agents] Note: what is shared is agent ACTIVITY — the folder name, tool names,\n' +
      '               and file paths your agents touch. Not your prompts or code.',
  );

  // Membership alone reports nothing: the hook entries in the agent's own
  // settings file are what actually produce events. Leaving that to a second,
  // separate trip through the browser UI was the step people skipped, and a
  // machine that joined but never installed hooks looks identical to a broken
  // network. So finish the job here.
  await ensureHooksInstalled(args, packageRoot);
}

/**
 * Install the Claude hooks as part of joining, asking first.
 *
 * The in-app dialog remains the way the GUI asks, and an already-granted
 * consent is not re-asked. This path exists because `--join` is itself an
 * explicit, interactive instruction to wire this machine up; refusing to act on
 * it without a browser round-trip is what made joining feel broken. The write
 * is still never silent: a fresh machine gets the provider's own disclosure and
 * has to answer, and a non-interactive shell is told what to run rather than
 * being decided for.
 */
async function ensureHooksInstalled(args: CliArgs, packageRoot: string): Promise<void> {
  if (await claudeProvider.areHooksInstalled()) {
    console.log('[Pixel Agents] Claude hooks already installed — nothing else to do.');
    return;
  }

  if (getHooksConsent(claudeProvider.id) !== 'granted' && !args.yes) {
    const { headline, disclosure } = claudeProvider.consentDisclosure();
    console.log(`\n  ${headline}\n`);
    for (const line of disclosure.split('\n')) console.log(`  ${line}`);
    console.log('');
    if (!(await askYesNo('  Install the Claude hooks now? [y/N] '))) {
      console.log(
        '\n[Pixel Agents] Left your Claude settings alone. You are joined, but nothing will\n' +
          '               report until hooks are on — re-run with --yes, or enable\n' +
          '               "Instant Detection (Hooks)" in the app settings.',
      );
      return;
    }
  }

  if (!copyHookScriptOrReport(packageRoot, ' (join)')) return;
  try {
    // The claude installer ignores both arguments -- the hook script discovers
    // servers on its own -- so a machine with no local server installs fine.
    await claudeProvider.installHooks('', '');
    grantHooksConsent(claudeProvider.id);
    setHooksEnabled(claudeProvider.id, true);
    console.log('[Pixel Agents] Claude hooks installed. Start Claude anywhere and you appear.');
  } catch (err) {
    console.error(
      `[Pixel Agents] Hook install failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Ask a yes/no question on the terminal. A non-TTY stdin (a script, a pipe, CI)
 * gets `false` rather than a hang -- the caller then prints how to proceed
 * explicitly, which is the honest outcome for an unattended run.
 */
async function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log(`${question}(not a terminal — assuming no)`);
    return false;
  }
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Joining and leaving are config edits, not a server run: they finish before
  // any asset loading or port binding so `--join` on a machine that never hosts
  // an office is instant and side-effect-free beyond the one file it writes.
  // dist/ contains both the CLI bundle and the assets/ + webview/ directories
  const distRoot = __dirname;
  const packageRoot = path.dirname(distRoot);

  if (args.join || args.leave) {
    await applyTeamMembership(args, packageRoot);
    return;
  }

  const staticDir = path.join(distRoot, 'webview');

  // ── Load assets on startup (same pipeline as VS Code extension) ──
  // External asset directories are merged at startup too, so directories added
  // in a previous session survive a restart. buildAssetCache is the shared
  // loader used by both the standalone server and the VS Code adapter.
  console.log('[Pixel Agents] Loading assets...');
  const assetCache: AssetCache = await buildAssetCache(
    distRoot,
    readConfig().externalAssetDirectories,
  );
  const charCount = assetCache.characters?.characters.length ?? 0;
  const petCount = assetCache.pets?.pets.length ?? 0;
  const furnitureCount = assetCache.furniture?.catalog.length ?? 0;
  console.log(
    `[Pixel Agents] Assets loaded: ${charCount} characters, ${petCount} pets, ${furnitureCount} furniture items`,
  );

  // ── Store + adapter (shared settings + standalone-scoped agents/seats) ──
  const store = new AgentStateStore();
  const adapter = new FileStateAdapter({ namespace: 'standalone' });
  store.setAdapter(adapter);

  // ── Create server ──
  const server = new PixelAgentsServer();

  try {
    // Create runtime first (before server.start, so we can pass it in)
    const runtime = new AgentRuntime(store, claudeProvider);

    // Wire hook events: HTTP POST -> runtime -> hookEventHandler -> agents
    server.onHookEvent((providerId, event) => {
      runtime.handleHookEvent(providerId, event);
    });

    // onSetHooksEnabled side effect: install/uninstall the named provider's
    // hooks when the user toggles in the UI (or answers the consent ask).
    // Captures config from the outer scope after server.start().
    let currentConfig: { port: number; token: string } | null = null;
    const onSetHooksEnabled = async (providerId: string, enabled: boolean): Promise<void> => {
      if (!currentConfig) return;
      const provider = hookProviderById(providerId);
      if (!provider) return; // unknown id: nothing to install into
      if (enabled) {
        // An explicit toggle in the UI IS the consent to modify the
        // provider's settings file. The bundled claude-hook.js script belongs
        // to the Claude provider alone; another provider's install must
        // neither copy it nor be blocked by it.
        grantHooksConsent(provider.id);
        if (
          provider.id === claudeProvider.id &&
          !copyHookScriptOrReport(packageRoot, ' (user toggle)')
        ) {
          return;
        }
        try {
          await provider.installHooks(
            `http://127.0.0.1:${currentConfig.port}`,
            currentConfig.token,
          );
        } catch (err) {
          console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
        console.log('[Pixel Agents] Hooks installed (user toggle)');
      } else {
        try {
          await provider.uninstallHooks();
          console.log('[Pixel Agents] Hooks uninstalled (user toggle)');
        } catch (err) {
          console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };

    // onReloadAssets side effect: re-run the shared loaders (bundled + external
    // dirs) after an external-asset-directory change, then re-broadcast the
    // updated sprites to the requesting client. Mutates the assetCache object in
    // place so already-open sockets (which captured the same reference) and
    // future webviewReady handshakes both observe the new assets. Only
    // characters/pets/furniture can come from external dirs, so only those three
    // are reloaded and re-sent (mirrors the VS Code reload path).
    const onReloadAssets: ReloadAssetsSideEffect = async (send): Promise<void> => {
      const externalDirs = readConfig().externalAssetDirectories;
      const [characters, pets, furniture] = await Promise.all([
        loadAllCharacters(distRoot, externalDirs),
        loadAllPets(distRoot, externalDirs),
        loadAllFurniture(distRoot, externalDirs),
      ]);
      assetCache.characters = characters;
      assetCache.pets = pets;
      assetCache.furniture = furniture;
      if (characters) {
        send({ type: 'characterSpritesLoaded', characters: characters.characters });
      }
      if (pets) {
        send({
          type: 'petSpritesLoaded',
          pets: pets.pets,
          petNames: pets.manifests.map((m) => m.name),
        });
      }
      if (furniture) {
        send({
          type: 'furnitureAssetsLoaded',
          catalog: furniture.catalog,
          sprites: Object.fromEntries(furniture.sprites),
        });
      }
      console.log('[Pixel Agents] Assets reloaded (external directory change)');
    };

    const config = await server.start({
      store,
      runtime,
      embedded: false,
      host: args.host,
      port: args.port,
      staticDir,
      distRoot,
      assetCache,
      onSetHooksEnabled,
      onReloadAssets,
    });
    currentConfig = { port: config.port, token: config.token };

    // Sync runtime refs with persisted settings BEFORE first scan tick. The
    // runtime's single hooksEnabled ref follows the Claude provider until the
    // scanners grow per-provider awareness alongside the Settings UI.
    runtime.hooksEnabled.current = getHooksEnabled(claudeProvider.id);
    runtime.watchAllSessions.current = adapter.getSetting('pixel-agents.watchAllSessions', false);

    // Install hooks on startup if the persisted setting says so — gated on the
    // one-time consent to modify ~/.claude/settings.json.
    if (runtime.hooksEnabled.current) {
      let consent = getHooksConsent(claudeProvider.id) === 'granted';
      if (!consent && (await claudeProvider.areHooksInstalled())) {
        // Our hooks are already installed and already firing — a pre-consent
        // version put them there. Grant and continue with NO prompt: the
        // install below is the 14 -> 12 migration, and it only ever REDUCES
        // scope (it drops UserPromptSubmit and TaskCreated, the two events that
        // forwarded prompt text and were consumed by nothing). Asking would buy
        // this user no protection they do not already have, so they are not
        // asked. A fresh install still is, in full — in the browser UI, when a
        // tokened client connects (clientMessageHandler's webviewReady).
        grantHooksConsent(claudeProvider.id);
        consent = true;
      }
      if (!consent) {
        console.log(
          '[Pixel Agents] Hooks not installed: modifying ~/.claude/settings.json needs one-time approval — open the URL below to review and approve it.',
        );
      } else if (copyHookScriptOrReport(packageRoot)) {
        try {
          await claudeProvider.installHooks(`http://127.0.0.1:${config.port}`, config.token);
          console.log('[Pixel Agents] Hooks installed');
        } catch (err) {
          console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else {
      // Without this line, a persisted hooks-off makes startup skip the entire
      // consent/install flow with zero output — indistinguishable from a bug.
      console.log(
        '[Pixel Agents] Hooks disabled — enable "Instant Detection (Hooks)" in the UI settings to install them.',
      );
    }

    // Start scanning for external sessions (Claude running in user's terminal)
    const cwd = process.cwd();
    const dirs = claudeProvider.getSessionDirs?.(cwd);
    if (dirs && dirs[0]) {
      const projectDir = dirs[0];
      console.log(`[Pixel Agents] Scanning project dir: ${projectDir}`);
      runtime.startProjectScan(projectDir);
      runtime.startExternalScanning(projectDir);
      runtime.startStaleCheck();
    }

    // Outside the project-dir guard on purpose: teammates report work that
    // lives on their own disk, so no local folder gates their presence.
    runtime.startRemotePresenceCheck();

    // The URL the operator opens has to be REACHABLE (a wildcard bind address
    // is a bind target, not an address you can browse to — `--host 0.0.0.0`
    // used to print a dead `http://0.0.0.0:PORT`) and has to carry the token,
    // which is what makes the session it loads privileged enough to approve a
    // hook install (see standaloneTokenValid in httpServer.ts). Under `--host
    // 0.0.0.0` the office stays readable from the LAN at this machine's own
    // address; only the consent-bearing toggle needs the token.
    const displayHost =
      args.host === '0.0.0.0' || args.host === '::' || args.host === '' ? '127.0.0.1' : args.host;
    console.log(
      `\n  Pixel Agents server running at http://${displayHost}:${config.port}/?token=${config.token}\n`,
    );

    // A wildcard bind is the only reason to host a shared office, so that is
    // when the join instructions are worth printing -- and the ONLY token that
    // appears here is the team one. Handing colleagues the URL above instead
    // would hand them the power to rewrite this machine's ~/.claude/settings.json.
    const isSharedBind = args.host === '0.0.0.0' || args.host === '::';
    const teamToken = server.getTeamHostToken();
    if (isSharedBind && teamToken) {
      const lanHost = firstNonLoopbackAddress() ?? displayHost;
      console.log('  Shared office — colleagues join from their own machine with:\n');
      // Deliberately NOT `npx pixel-agents`: that resolves to the published
      // package, and a colleague whose copy predates team support would run a
      // build with no --join at all. Whatever they launch this server with is
      // by definition a copy that has it.
      console.log(
        `    pixel-agents --join http://${lanHost}:${config.port} --token ${teamToken} --as <name>\n`,
      );
      console.log(
        '  Run that with the same pixel-agents build you started this server with —\n' +
          '  a copy without team support has no --join.\n',
      );
      console.log(
        '  That token only accepts agent events. Keep the URL above (with ?token=) to\n' +
          "  yourself: it is the one that can change this machine's Claude settings.\n",
      );
      // The trap this catches: teammates bypass the tracked-project gate, so a
      // host who works outside the folder they launched from sees EVERYONE
      // except themselves -- and reads that as the feature being broken.
      if (!readConfig().standalone?.watchAllSessions) {
        console.log(
          '  Heads up: your own agents only show up for work inside\n' +
            `  ${process.cwd()}\n` +
            '  Turn on Settings -> Watch All Sessions to see your other projects too\n' +
            '  (that also shows them to everyone watching this office).\n',
        );
      }
    }

    // ── Graceful shutdown ──
    function shutdown(): void {
      console.log('\nShutting down...');
      runtime.dispose();
      server.stop();
      process.exit(0);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Only auto-run when this file is executed directly (`node dist/cli.js`), not
// when it's imported for its exports (e.g. `parseArgs` in tests) -- importing
// it unconditionally used to start a real server and install real Claude
// hooks as a side effect of module load.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
