/**
 * CODE14's brand palette, in one place.
 *
 * Sampled from code14.nl's own computed styles rather than eyeballed off a
 * screenshot. Two very different things read from this -- the pixel-art asset
 * generator and the server-rendered join page -- and a brand that drifts
 * between them would look like two different companies.
 */
export const CODE14 = {
  /** Site header and every outline: a very dark desaturated teal. */
  dark: '#253637',
  /** One step deeper, for text on light panels. */
  darker: '#1c292a',
  /** The accent. Used sparingly, exactly as the site uses it. */
  coral: '#f8835b',
  /** Mid sage, for filled panels. */
  mint: '#96b9b6',
  /** Pale mint, for section backgrounds. */
  paleMint: '#d2e7e2',
  /** Warm off-white ground. */
  paper: '#f2f2f0',
  /** Muted text on the paper ground. */
  muted: '#5c6b6b',
} as const;
