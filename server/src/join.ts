/**
 * The joiner: everything a colleague's machine needs, in one file the office
 * hands out itself.
 *
 * Joining used to mean cloning the repository, installing its dependencies and
 * building it -- three minutes and a working toolchain to accomplish two file
 * writes. This bundle is served by the office at /api/join.js, downloads the
 * hook script from that same office, records the membership, and installs the
 * hook entries. Nothing is cloned and nothing is built.
 *
 * It deliberately does NOT import the server: no Fastify, no runtime, no
 * assets. A joiner never hosts anything, and a bundle that pulled the server in
 * would need dependencies that a bare machine does not have.
 *
 *   node join.js <office-url> [--as name] [--yes]     join
 *   node join.js <office-url> --leave [--yes]          leave again
 *
 * Leaving matters as much as joining: somebody who arrived through
 * `curl ... | sh` has no CLI to undo it with, so without this their only exit
 * was editing files in their home directory by hand.
 *
 * No shebang in this file on purpose: esbuild adds one as a banner, and two
 * would make line 2 of the bundle a syntax error.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';

import { grantHooksConsent, setHooksEnabled } from './configPersistence.js';
import { getHookScriptPath } from './providers/hook/claude/claudeHookInstaller.js';
import { claudeProvider } from './providers/index.js';
import type { TeamServer } from './teamConfig.js';
import {
  isOwnOffice,
  localServerPorts,
  parseJoinUrl,
  readTeamServers,
  sameAddress,
  teamJsonPath,
  writeTeamServers,
} from './teamConfig.js';

/** Fetch a text resource from the office, following no redirects and holding
 *  no opinions: the office is the authority on its own hook script. */
function fetchText(server: TeamServer, urlPath: string): Promise<string> {
  const transport = server.protocol === 'https' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        hostname: server.host,
        port: server.port,
        path: urlPath,
        method: 'GET',
        timeout: 10_000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`${urlPath} returned HTTP ${String(res.statusCode)}`));
          return;
        }
        let body = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve(body));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`${urlPath} timed out — is the office still running?`));
    });
    req.end();
  });
}

function askYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.log(`${question}(not a terminal — assuming no)`);
    return Promise.resolve(false);
  }
  return import('readline').then((readline) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise<boolean>((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      });
    });
  });
}

/**
 * Undo a join.
 *
 * Membership goes first and unconditionally: that is the one thing that stops
 * this machine reporting anywhere, and it must not depend on the answer to any
 * question.
 *
 * The hooks are a separate decision, and only raised when NOTHING is left to
 * report to. Someone who is in two offices, or who runs an office of their own,
 * still needs them -- removing them because they left one room would break the
 * others silently.
 */
async function leaveOffice(server: TeamServer, assumeYes: boolean): Promise<void> {
  const before = readTeamServers();
  const remaining = before.filter((entry) => !sameAddress(entry, server));

  if (remaining.length === before.length) {
    console.log(`[Pixel Agents] Not a member of ${server.host}:${server.port} — nothing to leave.`);
  } else {
    writeTeamServers(remaining);
    console.log(`[Pixel Agents] Left the office at ${server.host}:${server.port}.`);
    console.log('[Pixel Agents] Your agents stop appearing there immediately.');
  }

  if (remaining.length > 0) {
    console.log(
      `[Pixel Agents] Still reporting to ${String(remaining.length)} other office(s), so the` +
        '\n               Claude hooks are left in place.',
    );
    return;
  }

  if (!(await claudeProvider.areHooksInstalled())) return;

  // Local offices are a reason to keep the hooks too, and this machine may be
  // running one -- but a joiner has no way to ask a server that is not there.
  // So the question is asked rather than assumed either way.
  if (!assumeYes) {
    console.log(
      '\n  You are not in any shared office any more. The Claude hooks are still' +
        '\n  installed in ~/.claude/settings.json. Remove them too?' +
        '\n  (Keep them if you also run a Pixel Agents office on this machine.)\n',
    );
    if (!(await askYesNo('  Remove the Claude hooks? [y/N] '))) {
      console.log('[Pixel Agents] Hooks left as they are.');
      return;
    }
  }

  try {
    await claudeProvider.uninstallHooks();
    // Persisted only AFTER the uninstall succeeded: flipping it first strands
    // the user with entries that still fire and a preference that says off.
    setHooksEnabled(claudeProvider.id, false);
    console.log('[Pixel Agents] Claude hooks removed.');
  } catch (err) {
    console.error(
      `[Pixel Agents] Could not remove the hooks: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const url = argv.find((a) => !a.startsWith('-'));
  const asIndex = argv.indexOf('--as');
  const label =
    (asIndex >= 0 ? argv[asIndex + 1] : undefined) ??
    process.env['USER'] ??
    process.env['USERNAME'] ??
    'someone';
  const assumeYes = argv.includes('--yes') || argv.includes('-y');
  const leaving = argv.includes('--leave');

  if (!url) {
    console.error('Usage: node join.js <office-url> [--as name] [--yes] [--leave]');
    process.exit(1);
  }

  const parsed = parseJoinUrl(url, label);
  if (!parsed.ok) {
    console.error(`[Pixel Agents] ${parsed.reason}`);
    process.exit(1);
  }
  const server = parsed.server;

  if (leaving) {
    await leaveOffice(server, assumeYes);
    return;
  }

  if (isOwnOffice(server, localServerPorts())) {
    console.error(
      `[Pixel Agents] ${server.host}:${server.port} is an office on THIS machine — not joining.`,
    );
    process.exit(1);
  }

  // The script comes from the office, which is the point: when the office is
  // updated its members pick the change up on their next join instead of
  // needing the repository at all.
  console.log(`[Pixel Agents] Fetching the hook script from ${server.host}:${server.port}…`);
  const script = await fetchText(server, '/api/hook-script');
  if (!script.includes('pixel-agents') && !script.includes('hook_event_name')) {
    // A captive portal or a stray proxy answering 200 with an HTML page would
    // otherwise be written to disk and then executed by Claude on every event.
    throw new Error('that did not look like a hook script — check the office address');
  }

  const dst = getHookScriptPath();
  fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
  fs.writeFileSync(dst, script, { mode: 0o700 });
  console.log(`[Pixel Agents] Hook script written to ${dst}`);

  const existing = readTeamServers();
  writeTeamServers([...existing.filter((e) => !sameAddress(e, server)), server]);
  console.log(
    `[Pixel Agents] Joined the office at ${server.host}:${server.port} as "${server.user}".`,
  );
  console.log(`[Pixel Agents] Membership saved to ${teamJsonPath()}`);

  if (await claudeProvider.areHooksInstalled()) {
    console.log('[Pixel Agents] Claude hooks already installed — you are done.');
    return;
  }

  if (!assumeYes) {
    const { headline, disclosure } = claudeProvider.consentDisclosure();
    console.log(`\n  ${headline}\n`);
    for (const line of disclosure.split('\n')) console.log(`  ${line}`);
    console.log('');
    if (!(await askYesNo('  Install the Claude hooks now? [y/N] '))) {
      console.log(
        '\n[Pixel Agents] Left your Claude settings alone. You are joined, but nothing will\n' +
          '               report until the hooks are on — re-run this with --yes.',
      );
      return;
    }
  }

  await claudeProvider.installHooks('', '');
  // Record the answer, so the office UI does not ask again on this machine and
  // a later `--leave` knows there is something to undo.
  grantHooksConsent(claudeProvider.id);
  setHooksEnabled(claudeProvider.id, true);
  console.log('[Pixel Agents] Claude hooks installed. Start Claude anywhere and you appear.');
}

main().catch((err: unknown) => {
  console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
