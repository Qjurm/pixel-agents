/**
 * Re-label busy agents every few seconds.
 *
 * A phrase chosen once at tool start and held until the tool finished made a
 * long Bash run look like a frozen character: same three words for two minutes.
 * The point of the nonsense labels is that the room feels alive, so they move.
 *
 * Only the WORDS change. The tool, its id and the animation stay exactly as
 * they were, which is why this can re-send `agentToolStart` for a tool that is
 * already running: the webview treats a repeat with a known toolId as a refresh
 * of the label (useExtensionMessages.ts).
 */

import { maskedStatusFor } from './activityMask.js';
import type { AgentStateStore } from './agentStateStore.js';
import { PHRASE_ROTATE_INTERVAL_MS } from './constants.js';

/**
 * Start rotating the labels of every agent that currently has a tool running.
 *
 * The seed advances with a tick counter rather than being random, so every
 * viewer of the same office reads the same words at the same moment -- two
 * people looking at one character and seeing different things would be a
 * small, confusing bug.
 */
export function startPhraseTicker(
  store: AgentStateStore,
  intervalMs: number = PHRASE_ROTATE_INTERVAL_MS,
): ReturnType<typeof setInterval> {
  let tick = 0;
  return setInterval(() => {
    tick++;
    for (const [id, agent] of store) {
      for (const [toolId, previous] of agent.activeToolStatuses) {
        const toolName = agent.activeToolNames.get(toolId) ?? '';
        if (!toolName) continue;
        const status = maskedStatusFor(toolName, `${toolId}:${String(tick)}`);
        // Skip a tick that happened to land on the same phrase: the client
        // would ignore it anyway, and not sending is cheaper than being
        // ignored.
        if (status === previous) continue;
        agent.activeToolStatuses.set(toolId, status);
        store.broadcast({ type: 'agentToolStart', id, toolId, status, toolName });
      }
    }
  }, intervalMs);
}
