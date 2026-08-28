/**
 * Disclosure text for the hooks consent gate. Both surfaces show the SAME
 * in-app ask: the server ships these strings in the `hooksConsentRequest`
 * message and the webview's IntroBubble (the greeter character's speech
 * bubble) renders them verbatim on the Intro's consent step, so there is
 * exactly one copy of the terms and no client-side duplicate to drift into
 * asking for approval on weaker terms.
 *
 * Two pieces: the HEADLINE is the title of the Intro's consent step and the
 * DISCLOSURE is that step's body. The headline carries NO disclosure facts —
 * every fact lives in the shared disclosure block, so no fact depends on how a
 * surface renders its title slot (consentCopy.test.ts pins that split).
 *
 * The event count is interpolated from CLAUDE_HOOK_EVENTS, never written out:
 * a hardcoded number silently becomes a lie the next time the list changes.
 */

import { CLAUDE_HOOK_EVENTS, SETTINGS_BACKUP_SUFFIX } from './constants.js';

const SETTINGS_FILE = '~/.claude/settings.json';

/** WHY we ask + WHAT we write. */
export const CONSENT_FACT_WHAT =
  `To bring your agents to life in real time, Pixel Agents adds hooks for ` +
  `${CLAUDE_HOOK_EVENTS.length} Claude Code events to ${SETTINGS_FILE}. ` +
  `Note that your existing settings are kept, and a one-time backup is saved as settings.json${SETTINGS_BACKUP_SUFFIX}.`;

/** WHAT data moves, and where it stops.
 *
 *  "Nothing leaves your machine" is not something this prompt can promise:
 *  `npx pixel-agents --host 0.0.0.0` binds the same server to every interface,
 *  and an accepted socket receives the store broadcasts
 *  (server/src/httpServer.ts). So it states the default and names the one
 *  thing that changes it, rather than making a promise the software can be
 *  asked to break. */
export const CONSENT_FACT_DATA =
  'Claude Code will send those events - including tool names and tool inputs - to a Pixel Agents ' +
  'server on this machine. Everything stays local - the server listens only on 127.0.0.1 - unless ' +
  'you explicitly start it with --host to expose it on your network.';

/** WHERE ELSE the data goes, once this machine has joined a shared office.
 *
 *  CONSENT_FACT_DATA names `--host` as the one thing that stops events being
 *  local. Joining a team office is a SECOND such thing, and a bigger one: it
 *  does not merely accept connections, it actively sends every event to a
 *  server on somebody else's machine. Leaving the disclosure at "everything
 *  stays local" once a team.json exists would make this prompt state the
 *  opposite of what the software then does, so the fact is built per-ask
 *  rather than frozen at module load. */
export function consentFactTeam(addresses: string[]): string {
  const where = addresses.join(', ');
  return (
    `This machine has joined a shared office at ${where}. The same events - tool names, tool ` +
    'inputs, and the folders your agents work in - are also sent there, to a Pixel Agents server ' +
    'on another machine, unencrypted over your network. Leave with: pixel-agents --leave <url>'
  );
}

/** HOW to undo it. */
export const CONSENT_FACT_REVERSIBLE =
  'You can remove the hooks at any time from Settings → Instant Detection (Hooks).';

/** Headline for the first-run gate — the only population that is asked. A user
 *  whose hooks a pre-consent version already installed is migrated silently
 *  (the migration only ever drops events), so there is no second headline.
 *  Title of the Intro's consent step ("Welcome to Pixel Agents!" is the
 *  Intro's own opening-step title, owned by the webview). Carries NO
 *  disclosure facts by design: the facts all live in CONSENT_DISCLOSURE. */
export const CONSENT_INSTALL_HEADLINE = 'One more thing: hooks!';

/** The three disclosure facts, in order, as one block.
 *
 *  This is the consent step's body. The IntroBubble splits it on the blank
 *  lines and renders every paragraph in full on the decision surface itself — no
 *  "Details" affordance, which would put the disclosure one click away from
 *  the decision it is there to inform. */
export const CONSENT_DISCLOSURE = [
  CONSENT_FACT_WHAT,
  CONSENT_FACT_DATA,
  CONSENT_FACT_REVERSIBLE,
].join('\n\n');

/**
 * The disclosure for one ask, given the shared offices this machine reports to.
 *
 * With no offices this is exactly CONSENT_DISCLOSURE, so the common case has
 * one authored copy and no divergence. With offices, the team fact is inserted
 * directly after the data fact it qualifies -- not appended at the end, where a
 * reader who stopped at "everything stays local" would never reach it.
 */
export function buildConsentDisclosure(teamAddresses: string[]): string {
  if (teamAddresses.length === 0) return CONSENT_DISCLOSURE;
  return [
    CONSENT_FACT_WHAT,
    CONSENT_FACT_DATA,
    consentFactTeam(teamAddresses),
    CONSENT_FACT_REVERSIBLE,
  ].join('\n\n');
}
