import { RoomError } from './room.ts';

/**
 * What the person holding the phone actually does for a living.
 *
 * A room is a room to everybody. What is *taken off* it is not: a painter
 * prices the surface he rolls, a flooring contractor prices what goes on the
 * ground, a drywaller prices board and tape, and a general remodeler prices all
 * of it. They also use different words for the same measurement -- the number
 * this app calls "wall face" is the paintable area to one of them, the board
 * area to another, and neither of them says "wall face".
 *
 * So the app asks once what somebody does, and after that it says their words
 * and leads with their lines. **Nothing is hidden and nothing is invented**:
 * every takeoff line is still computed and still available, because a painter
 * who is also hanging a door needs the opening wrap and would be badly served
 * by an app that decided he was only a painter. A trade changes what is said
 * first and what it is called, and nothing else.
 *
 * That distinction is why this is a small file rather than four apps. Adding a
 * trade is data. Adding a trade that needs a different *measurement* -- roofing
 * wants pitch and squares off an exterior, which is a different problem and a
 * different product -- is not, and none is pretended here.
 */

export class TradeError extends RoomError {}

export interface Trade {
  readonly id: string;
  /** How it appears in the list. What somebody would call themselves. */
  readonly name: string;
  /** One line, so the list is a decision rather than a guess. */
  readonly does: string;
  /**
   * The takeoff lines this trade leads with, in order.
   *
   * Names from `takeoff.ts`. Anything not listed still appears, below these.
   */
  readonly leads: readonly string[];
  /**
   * What this trade calls things, where it differs from the app's own words.
   *
   * Keyed by the takeoff line's name. A trade that says the same thing has no
   * entry, rather than an entry repeating it.
   */
  readonly says: Readonly<Record<string, string>>;
}

/**
 * The trades this app can honestly serve today.
 *
 * All interior, all measured the same way: a closed room, walls, a floor and a
 * ceiling. Roofing, siding and concrete are deliberately absent -- they are
 * measured off the outside of a building and this app has never seen one.
 * Listing them and then serving them badly would be worse than not listing
 * them.
 */
export const TRADES: readonly Trade[] = [
  {
    id: 'general',
    name: 'General remodeling',
    does: 'Kitchens, baths, additions — a bit of everything',
    leads: ['Floor', 'Wall face', 'Ceiling', 'Baseboard'],
    says: {},
  },
  {
    id: 'painting',
    name: 'Painting',
    does: 'Walls, ceilings, trim',
    leads: ['Wall face', 'Ceiling', 'Baseboard', 'Opening wrap'],
    says: {
      'Wall face': 'Wall paint area',
      Ceiling: 'Ceiling paint area',
      Baseboard: 'Trim run',
      'Opening wrap': 'Jamb and casing',
    },
  },
  {
    id: 'flooring',
    name: 'Flooring',
    does: 'Wood, tile, vinyl, carpet',
    leads: ['Floor', 'Baseboard', 'Outside footprint'],
    says: {
      Floor: 'Finished floor area',
      Baseboard: 'Base and shoe',
      'Outside footprint': 'Room outside the finishes',
    },
  },
  {
    id: 'drywall',
    name: 'Drywall',
    does: 'Hanging, taping, finishing',
    leads: ['Wall face', 'Ceiling', 'Opening wrap', 'Studs'],
    says: {
      'Wall face': 'Board area, walls',
      Ceiling: 'Board area, ceiling',
      'Opening wrap': 'Returns',
    },
  },
  {
    id: 'tile',
    name: 'Tile',
    does: 'Floors, walls, backsplashes, showers',
    leads: ['Floor', 'Wall face', 'Baseboard'],
    says: {
      Floor: 'Floor tile area',
      'Wall face': 'Wall tile area',
      Baseboard: 'Bullnose and base run',
    },
  },
  {
    id: 'trim',
    name: 'Trim and carpentry',
    does: 'Base, casing, crown, built-ins',
    leads: ['Baseboard', 'Opening wrap', 'Reveal run', 'Wall face'],
    says: {
      Baseboard: 'Base run',
      'Opening wrap': 'Casing and jamb',
      'Reveal run': 'Reveal',
    },
  },
  {
    id: 'restoration',
    name: 'Restoration',
    does: 'Water, fire and mould, mostly for insurers',
    leads: ['Wall face', 'Floor', 'Ceiling', 'Baseboard'],
    says: {
      'Wall face': 'Affected wall area',
      Floor: 'Affected floor area',
    },
  },
  {
    id: 'framing',
    name: 'Framing',
    does: 'Walls, headers, openings',
    leads: ['Studs', 'Plates', 'Headers', 'Outside footprint'],
    says: {
      'Outside footprint': 'Framed footprint',
    },
  },
];

/** Nobody has said yet. Everything reads in the app's own words. */
export const NO_TRADE = 'general';

export function tradeOf(id: string): Trade {
  const found = TRADES.find((trade) => trade.id === id);
  if (found) return found;
  // Not an error: a saved company from a version with a trade this one dropped
  // should open, in plain words, rather than refusing to load somebody's work.
  return TRADES.find((trade) => trade.id === NO_TRADE)!;
}

/**
 * What this trade calls a takeoff line.
 *
 * Falls through to the app's own word, so a line no trade has an opinion about
 * still has a name.
 */
export function wordFor(trade: Trade, item: string): string {
  return trade.says[item] ?? item;
}

/**
 * The app's own name for something a trade calls by another name.
 *
 * The reverse of `wordFor`, and it exists for one reason: a rate is stored
 * against the app's own item name, so a painter who sets a rate for "Wall paint
 * area" and a drywaller who sets one for "Board area, walls" must both be
 * setting the rate for `Wall face`. Without this, changing trade would silently
 * orphan every rate somebody had set.
 */
export function itemFor(trade: Trade, word: string): string {
  const found = Object.entries(trade.says).find(([, said]) => said === word);
  return found ? found[0] : word;
}

/**
 * Takeoff lines in this trade's order.
 *
 * Its own lines first, in the order it leads with them, then everything else in
 * the order the takeoff produced it. Nothing is dropped: a painter hanging one
 * door still needs the opening wrap, and an app that decided he was only a
 * painter would be wrong at the worst moment.
 */
export function order<T extends { readonly what: string }>(
  trade: Trade,
  lines: readonly T[]
): readonly T[] {
  const rank = new Map(trade.leads.map((name, index) => [name, index]));
  return [...lines].sort((a, b) => {
    const left = rank.get(a.what) ?? Number.MAX_SAFE_INTEGER;
    const right = rank.get(b.what) ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) return left - right;
    return lines.indexOf(a) - lines.indexOf(b);
  });
}

/** Which lines this trade leads with, said for the screen that asks. */
export function describeTrade(trade: Trade): string {
  const words = trade.leads.map((item) => wordFor(trade, item));
  const last = words[words.length - 1];
  const rest = words.slice(0, -1);
  return rest.length > 0
    ? `Leads with ${rest.join(', ')} and ${last}. Everything else is still there, below.`
    : `Leads with ${last}. Everything else is still there, below.`;
}
