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
 *
 * In Dutch, like the house phrases below and like the room itself. These were
 * rewritten rather than translated: a joke carried across word for word stops
 * being one, so several of the English originals were dropped for jokes that
 * only work in Dutch instead.
 */
const PHRASES: Record<ActivityCategory, readonly string[]> = {
  reading: [
    'in de kleine lettertjes turen',
    'door het archief bladeren',
    'andermans huiswerk lezen',
    'de oude perkamenten raadplegen',
    'eerlijk gezegd aan het scannen',
    'de voorgeschiedenis opsnuiven',
    'naar regel 402 staren',
    'de runen ontcijferen',
    'hierogliefen ontleden',
    'de lore bijhouden',
    'het universum proeflezen',
    'tussen de regels lezen',
    'harder turen',
    'in de handleiding bladeren',
    'de voetnoten inspecteren',
    'kantlijnnotities controleren',
    'de documentatie wantrouwen',
    'twee keer hetzelfde lezen',
    'de changelog uitkammen',
    'zoeken waar het stond',
    'de README serieus nemen',
    'stiekem diagonaal lezen',
    'de comments geloven',
    'weer bij het begin beginnen',
  ],
  writing: [
    'combobulaties uitlijnen',
    'widgets reticuleren',
    'een puntkomma op zijn plek duwen',
    'ambachtelijke logica beitelen',
    'de fluxcondensator uitlijnen',
    'het alfabet herschikken',
    'er nog een vleugel aan bouwen',
    'met overtuiging typen',
    'stenen leren denken',
    'digitaal metselen',
    'randgevallen wegschaven',
    'de parser overtuigen',
    'erop rammen tot het past',
    'tactvol geweld toepassen',
    'de control flow haken',
    'drie nieuwe bugs verzinnen',
    'in woede refactoren',
    'een variabele slecht benoemen',
    'een haakje verplaatsen',
    'eerst de comment schrijven',
    'dat weer ongedaan maken',
    'nog een if erbij',
    'het zelfverzekerd erger maken',
    'alles hernoemen',
  ],
  running: [
    'erin porren met een stok',
    'uit en weer aan zetten',
    'een subproces oproepen',
    'voorzichtig aan de doos schudden',
    'op de grote rode knop drukken',
    'de bezwering opdreunen',
    'de machine laten beslissen',
    'het tegen het licht houden',
    'met de dobbelsteen gooien',
    'de computer vriendelijk vragen',
    'opwinden en laten gaan',
    'het orakel raadplegen',
    'aan de hendel trekken',
    'kijken wat er gebeurt',
    'het aan de daemon voeren',
    'de lont aansteken',
    'duimen',
    'naar een voortgangsbalk staren',
    'de cache de schuld geven',
    'nog eens, maar harder',
    'op het spinnertje wachten',
    'hopen',
    'node_modules leeggooien',
    'een puntkomma offeren',
  ],
  searching: [
    'in de lades rommelen',
    'onder de kussens kijken',
    'de hooiberg ondervragen',
    'een sterk vermoeden volgen',
    'de index raadplegen',
    'zijn eigen stappen terugvolgen',
    'rondsnuffelen',
    'de gebruikelijke verdachten checken',
    'op vingerafdrukken stoffen',
    'de buurt uitkammen',
    'elke steen omdraaien',
    'de theeblaadjes lezen',
    'het wrakhout doorzoeken',
    'een gerucht najagen',
    'een vermoeden trianguleren',
    'kijken waar het lag',
    'ctrl-F, maar spiritueel',
    'andermans TODO lezen',
    'het op de laatste plek vinden',
    'ervan overtuigd dat het hier was',
    'het verkeerde bestand openen',
    'de importketen volgen',
    'de codebase netjes vragen',
    'de zoekopdracht verbreden',
  ],
  thinking: [
    'betekenisvol in de verte staren',
    'de opties wegen',
    'doen alsof hij beraadslaagt',
    'er eens goed over nadenken',
    'de innerlijke wijsheid raadplegen',
    'in zijn hoofd rekenen',
    'naar het plafond staren',
    'gedachten bufferen',
    'aan een onzichtbare baard plukken',
    'dramatisch heen en weer lopen',
    'er een nachtje over doen',
    'een theorie in elkaar zetten',
    'alles heroverwegen',
    'op inspiratie wachten',
    'tot tien tellen',
    'twijfels krijgen',
    'diep zuchten',
    'het whiteboard aanstaren',
    'de vraag herformuleren',
    'even helemaal niets doen',
    'nadenken over nadenken',
    'zichzelf tegenspreken',
    'het plan nog eens lezen',
    'de moed verzamelen',
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
