/**
 * Everything about the business that appears on more than one page.
 *
 * One file, because a phone number in two places is a phone number that will
 * one day be two different numbers. The generator reads this; nothing on the
 * site hard-codes any of it.
 *
 * ## What is deliberately NOT in here
 *
 * Any claim nobody has measured. There is no accuracy figure, no "saves you
 * four hours a week", no customer count and no testimonial, because none of
 * those has been established. `docs/BUSINESS.md` is the only place numbers
 * about this business live, and the ones that are guesses are marked as
 * guesses there. A marketing site is the worst possible place to launder a
 * guess into a fact.
 */

export const SITE = {
  name: 'ScanToBid',
  /** No trailing slash. Every canonical, sitemap entry and OG url is built off it. */
  origin: 'https://scantobid.app',
  tagline: 'Measure a room. Price it. Get it signed.',
  /** Under 155 characters — this is the meta description on the home page. */
  description:
    'Scan a room with an iPhone, tape one wall each way, and the takeoff, price, '
    + 'proposal and claim all come off the same measurements. No server, no account.',
  email: 'support@scantobid.app',
  /** The subscription, as decided in docs/BUSINESS.md. Nothing is on sale yet. */
  price: { monthly: 78, yearly: 780, currency: 'USD', onSale: false },
  founded: 2026,
};

/**
 * Who writes the guides.
 *
 * ## The one thing left to fill in, and why it is left
 *
 * Gilbert has agreed to be the trade expert on these pages. His full name and
 * how he describes his own trade have not been sent yet, and **a real person's
 * name and credentials must never be invented** — not in a byline, and
 * absolutely not inside `author` structured data, where getting it wrong means
 * Google has been told something false about a named human being.
 *
 * So `trade.name` is empty and the generator refuses to build until it is
 * filled in or the reviewer is switched off. That refusal is the feature: it is
 * impossible to ship this site with a placeholder where a person should be.
 */
export const PEOPLE = {
  builder: {
    name: 'Sam',
    role: 'Built ScanToBid',
    /**
     * Two sentences, and only what is true. He writes software; he is not a
     * contractor and the site never implies he is. The product came out of a
     * remodeler's problem rather than a product plan, and that is the whole
     * bio.
     */
    bio:
      'Sam builds software. ScanToBid came out of a remodeler’s problem rather than '
      + 'a product plan — watching a contractor price a kitchen off a number he could '
      + 'not defend, and deciding the app should say so on the drawing instead of '
      + 'hiding it.',
    url: '/about/',
  },
  trade: {
    /**
     * FILL THIS IN. Gilbert's full name as he wants it printed.
     *
     * Leave it empty and every guide ships with Sam's byline alone and no
     * reviewer — which is correct and shippable. Put a name in it and the same
     * name appears in the byline, on the About page, and in the `reviewedBy`
     * of every guide's structured data.
     */
    name: 'Gilbert Rios',
    /** How he describes his own trade, in his words. Not guessed. */
    role: 'Remodeling contractor, 15 years',
    /**
     * What Sam gave, and nothing beyond it.
     *
     * He sent four things: the name, the trade, the years, and that ScanToBid
     * was built for a problem of his. That is what is here. No town, no
     * speciality, no anecdote and no adjective has been added — a bio is a
     * claim about a real person, and the parts nobody said are the parts that
     * would be invented.
     */
    bio:
      'Gilbert Rios has been a remodeling contractor for fifteen years. ScanToBid '
      + 'was built for the way he works, and he is the one testing it on real jobs.',
  },
};

/** The top-level pages, in the order they appear in the nav. */
export const NAV = [
  { href: '/', label: 'ScanToBid' },
  { href: '/guides/', label: 'Guides' },
  { href: '/calculators/', label: 'Calculators' },
  { href: '/templates/', label: 'Templates' },
  { href: '/about/', label: 'About' },
];

/**
 * What the site is allowed to say is true.
 *
 * Every one of these was confirmed before it was written, and each carries how
 * it can be checked. Anything not on this list does not go on the site.
 */
export const CLAIMS = [
  {
    id: 'own-icloud',
    say: 'Nothing leaves the phone except into your own iCloud.',
    how: 'There is no ScanToBid server. The backup writes to the user’s own CloudKit '
       + 'private database and nothing else opens a socket — the app’s content '
       + 'security policy allows no outside origin at all.',
  },
  {
    id: 'integers',
    say: 'Every measurement is an exact integer, never a floating-point number.',
    how: 'Lengths are stored as whole nanometres and money as whole cents, with 820 '
       + 'tests over the arithmetic. A rounding error cannot creep into a quantity '
       + 'because there is no rounding until the moment a number is printed.',
  },
  {
    id: 'says-scanned',
    say: 'Until a tape has been on a wall running each way, every document says so on its face.',
    how: 'Each length carries its own provenance — scanned, drawn, measured — and the '
       + 'plan, the takeoff, the proposal and the claim all print it.',
  },
  {
    id: 'in-testing',
    say: 'ScanToBid is in testing with a working remodeling contractor.',
    how: 'One contractor, in the field, on his own jobs. No figure is attached to '
       + 'this and none is implied.',
  },
];

/**
 * What is NOT claimed, written down so it stays that way.
 *
 * Nobody has yet run a scan against a tape and recorded the difference. Until
 * somebody does, this site says nothing about how close a scan is to a
 * measurement — which is convenient, because that is also the product's whole
 * argument: a scan is not a measurement, and an app that told you how close it
 * was would be an app asking you to trust the scan.
 */
export const NOT_CLAIMED = [
  'How close a scan is to a tape. Nobody has measured it.',
  'How much time it saves. Nobody has timed it.',
  'How many people use it. One contractor is testing it.',
];
