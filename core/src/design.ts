/**
 * One palette, one type scale, one set of spacings — for both halves of the app.
 *
 * ## Why this file exists
 *
 * Trueline is two programs. The screens where the work happens are TypeScript in
 * a web view; the tab bar, the room list and the two capture screens are Swift.
 * A person holding the phone cannot tell and must not be able to. Before this,
 * the web half was Tailwind's stock slate and the native half was whatever iOS
 * hands you, and the seam showed the moment you opened a room.
 *
 * A palette maintained twice is a palette that disagrees with itself, and the
 * disagreement shows up as *the same thing being two colours*. So the values
 * live here once and `core/tools/gen-design.mjs` writes both:
 *
 *   - `web/src/tokens.css` — custom properties, with a dark set
 *   - `ios/Trueline/Design.swift` — the same values as SwiftUI colours
 *
 * The same discipline `Entitlement.swift` already keeps, for the same reason.
 *
 * ## The direction, decided 2026-08-26
 *
 * **A field instrument.** Graphite ground that goes white in sunlight, amber for
 * anything the sensor guessed at, green for anything a person has put a tape on,
 * every number in a monospaced face. Not a document — client-facing documents
 * are their own thing and stay on paper.
 *
 * Sam chose it from two directions built as real screens and compared side by
 * side. The deciding argument was light: a phone goes from a driveway in full
 * sun to a basement with one bulb in about ten minutes, and only a palette that
 * follows the phone survives both.
 *
 * ## Colour carries meaning here, and only one meaning each
 *
 * `scanned` is amber and `measured` is green, everywhere, on every surface, in
 * both halves. A wall, a takeoff line, a price line and a tag all use the same
 * two colours to say the same two things, because a contractor should learn that
 * once. Amber is also the brand's accent, which sounds like a conflict and is
 * not: this product's whole personality is *that number has not been checked*.
 */

/** A colour with a value for each ground. Every colour in here has both. */
export interface Tone {
  /** On the light ground — a driveway at one in the afternoon. */
  readonly light: string;
  /** On the dark ground — a basement with one bulb. */
  readonly dark: string;
}

/**
 * Neutrals, warmed by a hair toward the amber rather than left at pure grey.
 *
 * `ground` is what the app sits on, `raise` is a surface standing on it, `ink`
 * is text, `rule` is a hairline. The dark values are not inversions of the light
 * ones: a straight inversion puts pure white text on near-black, which glares in
 * a dark room, so the dark ink stops short of white and the dark ground stops
 * short of black.
 */
export const NEUTRAL = {
  /** What the app sits on. */
  ground: { light: '#F5F7F8', dark: '#0F1316' },
  /** A surface standing on the ground: a card, a bar, a sheet. */
  raise: { light: '#FFFFFF', dark: '#1B2126' },
  /** Inset INTO a surface: a tab strip, a well, a read-only row. */
  sunk: { light: '#EDF0F2', dark: '#171C20' },
  ink: { light: '#14181B', dark: '#E4E7E9' },
  /** Secondary text: a caption, a unit, a label. */
  quiet: { light: '#4B545B', dark: '#A9B3BA' },
  /** Tertiary: present, but not what is being read right now. */
  faint: { light: '#6B747B', dark: '#79838B' },
  /** A hairline between rows or around a control. */
  rule: { light: '#DFE3E6', dark: '#2B3238' },
  /** A quieter hairline, inside a group. */
  hair: { light: '#E9ECEE', dark: '#232A2F' },
} as const satisfies Record<string, Tone>;

/**
 * The four words this app exists to keep apart, and what goes around them.
 *
 * `scanned`, `measured`, `derived` and `adjusted` are not decoration. Every
 * dimension in the app is exactly one of them, and the colour is how somebody
 * reads which at a glance without reading a word. They mean the same thing on a
 * wall, on a takeoff line, on a price line and on a tag, in both halves of the
 * app, forever.
 *
 * Each carries three values, because a meaning needs three places to live: the
 * text itself, a tinted ground to sit a whole block on, and a border. Left to
 * "whatever amber looked right", one screen's warning panel ends up a different
 * amber from the next one's.
 */
export const MEANING = {
  /** The sensor's own number. Nobody has checked it. */
  scanned: { light: '#8F4408', dark: '#F0A85C' },
  scannedSoft: { light: '#FDF3E7', dark: '#2A1C10' },
  scannedEdge: { light: '#EBC9A2', dark: '#4A3117' },

  /** Somebody put a tape on it. */
  measured: { light: '#1F7A4D', dark: '#6FD39C' },
  measuredSoft: { light: '#EDF7F1', dark: '#0F241A' },
  measuredEdge: { light: '#A9D6BE', dark: '#1E4632' },

  /** Worked out from something measured, rather than measured itself. */
  derived: { light: '#5A6570', dark: '#8B979F' },

  /**
   * Moved by hand: somebody dragged it rather than measuring it.
   *
   * Its own colour and not a shade of the other three, because it is its own
   * claim — a wall that was adjusted is neither what the sensor said nor what a
   * tape said, and a drawing has to be able to admit that.
   */
  adjusted: { light: '#5B3C9E', dark: '#B79DEE' },
  adjustedSoft: { light: '#F3EFFC', dark: '#1E1730' },
  adjustedEdge: { light: '#C6B4EC', dark: '#3A2D5C' },

  /** The brand's amber, for a control that ACTS rather than a state. */
  accent: { light: '#B8590A', dark: '#D06A12' },
  /** Text on the accent. */
  onAccent: { light: '#FFFFFF', dark: '#FFFFFF' },

  /** A refusal: the app declining to invent something it does not know. */
  refuse: { light: '#A31212', dark: '#F08A8A' },
  refuseSoft: { light: '#FCEFEF', dark: '#2A1212' },
  refuseEdge: { light: '#E9B4B4', dark: '#4E2020' },

  /**
   * Focus, selection, and a window on a drawing.
   *
   * The one hue in here that carries no claim about a measurement, which is
   * exactly why it can be the focus ring: a focused field must not look like a
   * wall somebody has not checked.
   */
  focus: { light: '#2C6FA8', dark: '#5FA0D0' },
  focusSoft: { light: '#EDF4FA', dark: '#0F1E29' },
  focusEdge: { light: '#A9C9E2', dark: '#254559' },
} as const satisfies Record<string, Tone>;

/**
 * The faces, and where each is used.
 *
 * **Archivo** for anything that is words, because it is a grotesque with real
 * width at small sizes and it does not look like a website. **IBM Plex Mono**
 * for every number in the app without exception — a column of dimensions has to
 * line up, and a digit that changed has to be visible in the place it changed.
 *
 * Both are shipped inside the app rather than fetched. That is not a preference:
 * this app is used in basements with no signal, and until 2026-08-26 the
 * handbook linked Google Fonts, which means it had never once rendered in
 * Archivo on the phone it was written for.
 */
export const TYPE = {
  /** Everything that is words. */
  sans: `Archivo, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`,
  /** Every number, everywhere, no exceptions. */
  mono: `"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`,
} as const;

/**
 * The type scale, in pixels at the root size.
 *
 * Six steps and no more. A scale somebody can hold in their head is a scale that
 * gets used; twelve steps becomes "whatever looks right", which is how a screen
 * ends up with four different sizes of caption on it.
 */
export const SIZE = {
  /** A unit beside a number, a tolerance, a tab label. */
  micro: 10,
  /** A caption or a hint under a control. */
  small: 12,
  /** Running text and every control label. */
  body: 15,
  /** A row that matters more than the rows around it. */
  lead: 17,
  /** A section heading. */
  head: 21,
  /** The one number on a screen that a person came to read. */
  figure: 27,
} as const;

/**
 * Spacing, in pixels.
 *
 * ## Why these are tighter than a normal app's
 *
 * The first pass put the palette and the faces in and moved no layout, and
 * seeing it on a phone made the next thing obvious: there was too much air in
 * it for a tool. A consumer app is read; an instrument is SCANNED, standing up,
 * one-handed, with a tape in the other hand — and every pixel of padding is a
 * row of the wall schedule that fell off the bottom of the screen.
 *
 * So the scale is about a quarter tighter than the stock one it replaces:
 * a card's padding goes 16 to 12, the gap between panels 20 to 15, a row's
 * breathing room 12 to 9. Nothing was re-laid-out to get there. Tailwind's
 * numeric steps are pointed at these names, so 898 spacing classes across forty
 * files tightened at once — the same trick the colours use.
 *
 * ## What does NOT move
 *
 * `TOUCH` below. Every control in this app is at least 44 pixels tall and the
 * ones that take a tape reading are 48, and density is never allowed to buy
 * itself out of that: a screen you can read and cannot hit is worse than one
 * that scrolls.
 */
export const SPACE = {
  /** Between two things that are one thing. */
  hair: 2,
  /** Inside a chip, between an icon and its word. */
  tight: 4,
  /** Between rows of a list. */
  snug: 6,
  /** Around a row, inside a control. */
  step: 9,
  /** Inside a card. */
  room: 12,
  /** Between cards. */
  apart: 15,
  /** Between the parts of a screen. */
  wide: 18,
  /** Between one screen's worth of content and the next. */
  gap: 24,
} as const;

/**
 * Corner radii.
 *
 * Small, deliberately. Nothing on a measuring instrument is rounded, and the
 * generous radius that reads as friendly on a consumer app reads as unserious
 * on a tool somebody is about to price a job with.
 */
export const RADIUS = {
  /** A chip, a tag, a badge. */
  chip: 2,
  /** A control: a button, a field, a select. */
  control: 4,
  /** A surface: a card, a panel, a sheet. */
  surface: 6,
} as const;

/**
 * The smallest a target may be, in pixels.
 *
 * Apple says 44. This app is used with a tape measure in the other hand and
 * sometimes with a glove on, so the controls that take a reading are bigger than
 * the minimum and nothing anywhere is smaller than it.
 */
export const TOUCH = { least: 44, comfortable: 48 } as const;

/** Every named colour, for a generator that wants to walk them all. */
export const TONES: Readonly<Record<string, Tone>> = { ...NEUTRAL, ...MEANING };
