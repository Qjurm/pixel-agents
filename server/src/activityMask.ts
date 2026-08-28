/**
 * Turning "what someone is doing" into "roughly what kind of thing someone is
 * doing", plus a nonsense phrase to say it with.
 *
 * A shared office is a room full of colleagues, not an audit log. Tool names,
 * command lines, file paths and folder names are all far more than presence
 * needs, and once they have crossed the network they have crossed it. So the
 * masking happens at the SOURCE -- the hook script sends only what is in here,
 * and a person's own office keeps the full detail it always had.
 *
 * This module is imported by the bundled hook script, so it must stay free of
 * any runtime dependency: pure data and pure functions only.
 */

/** The whole vocabulary a teammate's activity is reduced to. */
export const ACTIVITY_CATEGORIES = [
  'reading',
  'writing',
  'running',
  'searching',
  'thinking',
] as const;

export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export function isActivityCategory(value: unknown): value is ActivityCategory {
  return typeof value === 'string' && (ACTIVITY_CATEGORIES as readonly string[]).includes(value);
}

/** Tools whose work is looking at things. */
const READING_TOOLS = new Set(['Read', 'NotebookRead', 'Artifact']);
/** Tools whose work is changing things. */
const WRITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'ReportFindings']);
/** Tools whose work is finding things. */
const SEARCHING_TOOLS = new Set(['Grep', 'Glob', 'WebSearch', 'WebFetch', 'ToolSearch']);
/** Tools whose work is making something else do the work. */
const RUNNING_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell', 'Task', 'Agent', 'Workflow']);

/**
 * Reduce a tool name to one of five categories.
 *
 * Unknown tools -- an MCP server's own tools, a newer CLI's additions -- land
 * on 'running', deliberately the vaguest of the action categories. Guessing
 * from the NAME of an unknown tool would defeat the point: the name is exactly
 * the thing being withheld.
 */
export function categoriseTool(toolName: string): ActivityCategory {
  if (READING_TOOLS.has(toolName)) return 'reading';
  if (WRITING_TOOLS.has(toolName)) return 'writing';
  if (SEARCHING_TOOLS.has(toolName)) return 'searching';
  if (RUNNING_TOOLS.has(toolName)) return 'running';
  return 'running';
}

/**
 * A stand-in tool name to travel in place of the real one.
 *
 * The office animates characters by tool name -- typing for edits, reading for
 * lookups (see the provider's `readingTools`) -- so sending a category alone
 * would leave teammates sitting motionless. These names carry no more
 * information than the category itself: every reading tool becomes 'Read'.
 */
export function representativeTool(category: ActivityCategory): string {
  switch (category) {
    case 'reading':
      return 'Read';
    case 'searching':
      return 'Grep';
    case 'writing':
      return 'Edit';
    case 'running':
      return 'Bash';
    case 'thinking':
      return 'Read';
  }
}

/**
 * What each category is allowed to say out loud. Nonsense on purpose: the
 * phrase should tell you a colleague is alive and busy, raise a smile, and
 * tell you nothing whatsoever about their work.
 */
const PHRASES: Record<ActivityCategory, readonly string[]> = {
  reading: [
    'squinting at the fine print',
    'leafing through the archives',
    'reading somebody else’s homework',
    'consulting the ancient scrolls',
    'skimming, honestly',
    'absorbing the prior art',
    'peering at line 402',
    'studying the runes',
  ],
  writing: [
    'combobulating the splines',
    'reticulating the widgets',
    'nudging semicolons into place',
    'sculpting artisanal logic',
    'aligning the flux capacitors',
    'rearranging the alphabet',
    'bolting on another wing',
    'typing with great intent',
  ],
  running: [
    'poking it with a stick',
    'turning it off and on again',
    'summoning a subprocess',
    'gently shaking the box',
    'pressing the big red button',
    'reciting the incantation',
    'letting the machine decide',
    'holding it up to the light',
  ],
  searching: [
    'rummaging in the drawers',
    'looking under the cushions',
    'interrogating the haystack',
    'following a strong hunch',
    'consulting the index',
    'retracing its own steps',
    'sniffing around',
    'checking the usual suspects',
  ],
  thinking: [
    'staring meaningfully into space',
    'weighing its options',
    'pretending to deliberate',
    'having a long think',
    'consulting inner wisdom',
    'doing sums in its head',
    'gazing at the ceiling',
    'buffering thoughts',
  ],
};

/** Cheap, stable string hash. Not cryptographic -- it only has to spread. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Pick the phrase for one activity.
 *
 * Chosen by hashing a seed rather than at random, so the same activity keeps
 * the same words for as long as it is on screen -- a label that reshuffled
 * itself every render would read as a glitch. Different activities get
 * different words because the seed includes the tool's own id.
 */
export function maskedPhrase(category: ActivityCategory, seed: string): string {
  const options = PHRASES[category];
  return options[hash(`${category}:${seed}`) % options.length]!;
}
