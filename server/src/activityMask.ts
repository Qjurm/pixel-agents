/**
 * Turning "what someone is doing" into "roughly what kind of thing someone is
 * doing", plus a nonsense phrase to say it with.
 *
 * A shared office is a room full of colleagues, not an audit log. Tool names,
 * command lines and file paths are all far more than presence needs, so what
 * the office SHOWS is a category and a nonsense phrase -- and it shows the same
 * thing for everybody, the person hosting included. An office where one
 * person's work is legible and everyone else's is not is not a fair room.
 *
 * The masking is applied here, in the office, rather than by each reporting
 * machine. That is a deliberate trade for one-machine hosting on a trusted
 * network: the detail does reach the server, and the server is the only thing
 * that has to be updated for the rule to change or improve. Masking at the
 * source would keep the detail off the wire, but it would also mean every
 * teammate's build had to be current for the office to be private at all.
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
    'deciphering the hieroglyphs',
    'catching up on the lore',
    'proofreading the universe',
    'reading between the lines',
    'squinting harder',
    'thumbing through the manual',
    'inspecting the small letters',
    'auditing the marginalia',
    'making a face at the docs',
    'moving its lips slightly',
    'three tabs deep',
    'reading the commit message twice',
    'looking for the part that matters',
    'nodding at nothing',
    'lost in the appendix',
    'checking whether it said that',
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
    'teaching the rocks to think',
    'laying bricks, digitally',
    'whittling down the edge cases',
    'persuading the parser',
    'hammering it until it fits',
    'applying tasteful violence',
    'knitting the control flow',
    'inventing three new bugs',
    'refactoring in anger',
    'naming a variable, badly',
    'moving a bracket around',
    'writing the comment first',
    'undoing that',
    'adding one more if',
    'making it worse, confidently',
    'renaming everything',
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
    'rolling the dice',
    'asking the computer nicely',
    'winding it up and letting go',
    'consulting the oracle',
    'pulling the lever, Kronk',
    'seeing what happens',
    'feeding it to the daemon',
    'lighting the fuse',
    'crossing its fingers',
    'watching a progress bar',
    'blaming the cache',
    'running it again, but harder',
    'waiting for the spinner',
    'hoping',
    'clearing node_modules',
    'sacrificing a semicolon',
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
    'dusting for fingerprints',
    'canvassing the neighbourhood',
    'turning over every rock',
    'reading the tea leaves',
    'combing the wreckage',
    'chasing a rumour',
    'triangulating a hunch',
    'looking where it last was',
    'ctrl-F, but spiritually',
    'reading someone else’s TODO',
    'finding it in the last place',
    'convinced it was here',
    'opening the wrong file',
    'following the import chain',
    'asking the codebase politely',
    'widening the search',
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
    'stroking an imaginary beard',
    'pacing dramatically',
    'sleeping on it, briefly',
    'assembling a theory',
    'reconsidering everything',
    'waiting for inspiration',
    'counting to ten',
    'having second thoughts',
    'rubber-ducking',
    'looking out of the window',
    'considering a career change',
    'rereading its own plan',
    'quietly panicking',
    'making a coffee, mentally',
    'about to have an idea',
    'counting the edge cases',
  ],
};

/**
 * The one call the rest of the server makes: what an agent's activity is
 * allowed to look like. Note that the tool INPUT is not a parameter -- paths,
 * commands and prompts have no route to a label from here, by construction.
 */
export function maskedStatusFor(toolName: string, seed: string): string {
  return maskedPhrase(categoriseTool(toolName), seed);
}

/** The phrases a category may use. Exposed so a caller -- or a test -- can ask
 *  whether a given label belongs to the category it should have come from,
 *  without needing to know which of the phrases the seed happened to pick. */
export function phrasesFor(category: ActivityCategory): readonly string[] {
  return PHRASES[category];
}

/**
 * House phrases: the things that only happen at CODE14.
 *
 * Kept out of the category lists and drawn from occasionally instead, so they
 * land as an easter egg rather than as the office repeating the same in-joke
 * every third label. Any activity can produce one -- what somebody is actually
 * doing has nothing to do with whether they are eyeing up the Friday drinks.
 *
 * These name real colleagues, warmly and at their own request. Keep it that
 * way: this text shows up on everybody's screen, including theirs.
 */
const HOUSE_PHRASES: readonly string[] = [
  'Harm-Jan lief aankijken',
  'wachten tot Jelle knikt',
  'Geerten Pas om hulp vragen',
  'klagen bij Jordy ten Den',
  'een gunst vragen aan Tune Mulderij',
  'geld vragen aan Laura Klein Horstman',
  'het project bijwerken in RITA',
  'een ticket verstoppen in RITA',
  'de vrijdagmiddagborrel voorbereiden',
  'aftellen tot de borrel',
  'de configurator overtuigen',
  'een bedrijfsbureau digitaliseren',
  'wachten op gehaktbalwoensdag',
  'de laatste gehaktbal claimen',
  'brood halen bij de bakker',
  'een lunchwandeling inplannen',
  'de padelbaan reserveren',
  'zich drukken voor de bootcamp',
  'business denken, tech doen',
  'de hydraulische carrièremachine oliën',
  'digitale complexiteit vereenvoudigen',
  'een flinke tik eigenwijs doen',
  'iets uitleggen aan de business',
  'zeggen dat het in Laravel kan',
];

/** The house phrases, for callers that need to know a label could legitimately
 *  be one. Exposed because any masked status may be a house phrase, so a test
 *  that only accepts its own category's list is wrong one time in four. */
export function housePhrases(): readonly string[] {
  return HOUSE_PHRASES;
}

/** How often a house phrase turns up instead of a generic one, as one-in-N.
 *  Four felt right: often enough to notice, rare enough to stay a joke. */
const HOUSE_EVERY = 4;

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
  const h = hash(`${category}:${seed}`);
  // The coin flip reads the HIGH bits of a separately-seeded hash. A second
  // hash alone is not enough: FNV's low bits stay correlated across seeds that
  // share a suffix, and measured over 20k seeds that cost six of the
  // twenty-four reading phrases -- they were only ever chosen on ticks where
  // the house draw also fired, so they never appeared at all. Shifting past
  // those bits reaches every phrase while holding the same one-in-four rate.
  if ((hash(`house:${seed}`) >>> 8) % HOUSE_EVERY === 0) {
    return HOUSE_PHRASES[h % HOUSE_PHRASES.length]!;
  }
  const options = PHRASES[category];
  return options[h % options.length]!;
}

/**
 * The name a character wears in the office.
 *
 * Never a folder or a project: which repository someone has open is exactly
 * the kind of detail a presence display does not need, and in a room shared
 * with colleagues it is the detail people notice first. A teammate is named by
 * the label they joined with; the host's own agents fall back to the account
 * name of the machine, so the office is a room of people rather than a mix of
 * one person and several directories.
 */
export function displayNameFor(remoteUser: string | undefined, hostLabel: string): string {
  return remoteUser && remoteUser.length > 0 ? remoteUser : hostLabel;
}
