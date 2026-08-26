/**
 * The palette, pointed at the tokens.
 *
 * ## Why the ramps are remapped rather than the classes rewritten
 *
 * Forty component files use Tailwind's stock slate, amber, red, emerald, sky
 * and violet. Rewriting every class by hand would be forty files of risk for a
 * change that is supposed to move no layout, and it would have to be done again
 * the next time the palette moves.
 *
 * So the ramp NAMES stay and their VALUES are pointed at
 * `core/src/design.ts` through `src/tokens.css`. `text-slate-900` still says
 * text-slate-900 in the markup and now resolves to the ink token, which is
 * #14181B on a driveway and #E4E7E9 in a basement. Every screen became
 * theme-aware without a single component being touched.
 *
 * Each mapping below is a real reading of what that class is used for in this
 * app, taken from counting every use rather than from what the number suggests:
 * `slate-500` and `slate-700` both turned out to be secondary text, `sky-500`
 * turned out to be only ever the focus ring, and `violet` turned out to mean
 * "somebody moved this by hand" -- a fourth provenance that had no name.
 *
 * The channels-not-hex form is what makes `bg-raise/95` keep working on the
 * fixed bars. See the note at the top of `src/tokens.css`.
 */
const token = (name) => ({ opacityValue }) =>
  opacityValue === undefined
    ? `rgb(var(--c-${name}))`
    : `rgb(var(--c-${name}) / ${opacityValue})`;

/** A whole Tailwind ramp pointed at one token, so every step of it resolves. */
const flat = (name, steps) =>
  Object.fromEntries(steps.map((step) => [step, token(name)]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      colors: {
        // The neutrals. `white` is a SURFACE, not a colour: it is what a card
        // is, and in a basement a card is #1B2126.
        white: token('raise'),
        black: token('ink'),
        slate: {
          ...flat('ground', ['50']),
          ...flat('sunk', ['100']),
          ...flat('hair', ['150']),
          ...flat('rule', ['200', '300']),
          ...flat('faint', ['400', '500']),
          ...flat('quiet', ['600', '700']),
          ...flat('ink', ['800', '900', '950']),
        },
        // Amber is not a warning here. It is the sensor's own number, which
        // nobody has checked -- the single most important thing this app says.
        amber: {
          ...flat('scannedSoft', ['50', '100']),
          ...flat('scannedEdge', ['200', '300', '400']),
          ...flat('scanned', ['500', '600', '700', '800', '900']),
        },
        emerald: {
          ...flat('measuredSoft', ['50', '100']),
          ...flat('measuredEdge', ['200', '300', '400']),
          ...flat('measured', ['500', '600', '700', '800', '900']),
        },
        // Somebody dragged this rather than measuring it.
        violet: {
          ...flat('adjustedSoft', ['50', '100']),
          ...flat('adjustedEdge', ['200', '300', '400']),
          ...flat('adjusted', ['500', '600', '700', '800', '900']),
        },
        red: {
          ...flat('refuseSoft', ['50', '100']),
          ...flat('refuseEdge', ['200', '300', '400']),
          ...flat('refuse', ['500', '600', '700', '800', '900']),
        },
        // Focus, selection, and a window on a drawing. The one hue that makes
        // no claim about a measurement, which is why it can be the focus ring.
        sky: {
          ...flat('focusSoft', ['50', '100']),
          ...flat('focusEdge', ['200', '300', '400']),
          ...flat('focus', ['500', '600', '700', '800', '900']),
        },
        // Named for what they mean, for anything written from here on.
        ground: token('ground'),
        raise: token('raise'),
        sunk: token('sunk'),
        ink: token('ink'),
        quiet: token('quiet'),
        faint: token('faint'),
        rule: token('rule'),
        hair: token('hair'),
        scanned: token('scanned'),
        measured: token('measured'),
        derived: token('derived'),
        adjusted: token('adjusted'),
        accent: token('accent'),
        'on-accent': token('onAccent'),
        refuse: token('refuse'),
        focus: token('focus'),
      },
      spacing: {
        // Tailwind's numeric steps, pointed at the token scale.
        //
        // 898 spacing classes across forty files, and 873 of them are steps 1
        // to 5 -- which is to say all the air in the app is in five numbers.
        // Compressing those here tightens every screen at once without a
        // component being touched, exactly as the colours are remapped above.
        //
        // 11 and 12 are NOT part of that. They are `min-h-11` and `min-h-12`,
        // used 160 times, and they are the touch targets: 44 pixels for
        // anything you press and 48 for anything you press with a tape in the
        // other hand. Density never gets to buy itself out of those, so they
        // are pinned to the touch tokens by name rather than left on a scale
        // that something else might tighten later.
        '0.5': 'var(--space-hair)',
        '1': 'var(--space-tight)',
        '1.5': '5px',
        '2': 'var(--space-snug)',
        '2.5': '8px',
        '3': 'var(--space-step)',
        '4': 'var(--space-room)',
        '5': 'var(--space-apart)',
        '6': 'var(--space-wide)',
        '8': 'var(--space-gap)',
        '11': 'var(--touch-least)',
        '12': 'var(--touch-comfortable)',
      },
      borderRadius: {
        // Small, deliberately. Nothing on a measuring instrument is rounded,
        // and the generous radius that reads as friendly on a consumer app
        // reads as unserious on a tool somebody prices a job with.
        DEFAULT: 'var(--radius-control)',
        sm: 'var(--radius-chip)',
        md: 'var(--radius-control)',
        lg: 'var(--radius-surface)',
        xl: 'var(--radius-surface)',
        '2xl': 'var(--radius-surface)',
      },
    },
  },
};
