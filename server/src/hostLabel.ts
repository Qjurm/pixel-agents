import * as os from 'os';

import { sanitizeUserLabel } from './teamConfig.js';

/**
 * The name this machine's OWN agents wear in the office.
 *
 * Teammates arrive with a label they chose when joining; the host never had
 * one, because the host does not join anything. Falling back to the account
 * name keeps every character in the room named after a person instead of after
 * a directory, which is the whole point of not showing project names.
 *
 * Resolved per call rather than cached: it is cheap, and a cached value is one
 * more thing to be stale in a long-running server.
 */
export function hostLabel(): string {
  const raw = process.env['PIXEL_AGENTS_NAME'] ?? os.userInfo().username;
  return sanitizeUserLabel(raw) || 'someone';
}
