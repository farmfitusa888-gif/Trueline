/**
 * The free forms, as data.
 *
 * These are blank versions of the documents the app produces, generated at
 * build time by the same PDF library the app's own claim document uses. That
 * is the point of them: a contractor who downloads the blank estimate sheet
 * and later sees the app fill one in is looking at the same document.
 *
 * Every field on every one of these was chosen from the corresponding guide.
 * A form that asks for something the guide never explained is a form nobody
 * finishes.
 */
export const TEMPLATES = [
  {
    id: 'estimate-form',
    title: 'Blank construction estimate',
    file: 'trueline-estimate.pdf',
    blurb:
      'Every one of the eleven things an estimate needs, laid out with room to write. '
      + 'Including the exclusions block, which is the part most forms leave off.',
    guide: 'construction-estimate-template',
    fields: [
      'Contractor — name, address, phone',
      'Licence no.', 'Insurance',
      'Client', 'Address of the work',
      'Date', 'Price holds until',
      { block: 'Scope of work', lines: 4 },
      { block: 'Quantities — item / unit / amount', lines: 6 },
      { block: 'Price — item / rate / total', lines: 6 },
      { block: 'Not included', lines: 4 },
      'Allowances',
      'Payment terms',
      { note: 'Work outside this scope is quoted and signed before it starts.' },
      'Signed', 'Date',
    ],
  },
  {
    id: 'proposal-form',
    title: 'Remodeling proposal, two options',
    file: 'trueline-proposal.pdf',
    blurb:
      'Scope in sentences, two options rather than one price, an exclusions list and '
      + 'a signature block with the wording spelled out.',
    guide: 'remodeling-proposal',
    fields: [
      'Contractor', 'Licence no.',
      'Client', 'Address of the work', 'Date', 'Price holds until',
      { block: 'What the work covers', lines: 4 },
      { block: 'Option A — name, what it covers, price', lines: 3 },
      { block: 'Option B — name, what it covers, price', lines: 3 },
      { block: 'Not included', lines: 4 },
      { note: 'I have read this proposal, I agree to the work and the price in the option '
            + 'named above, and I intend this to be my signature.' },
      'Option taken', 'Signed', 'Printed name', 'Date',
    ],
  },
  {
    id: 'change-order-form',
    title: 'Change order',
    file: 'trueline-change-order.pdf',
    blurb:
      'One page, signed before the work starts. Old quantity and new quantity side by '
      + 'side, the reason, the price of the change on its own, and the schedule effect.',
    guide: 'change-order',
    fields: [
      'Change order no.', 'Date',
      'Changes the agreement dated', 'For the work at',
      { block: 'What is different', lines: 4 },
      'Quantity — was', 'Quantity — now',
      { block: 'Why — client request, unforeseen condition, design change', lines: 2 },
      'Price of this change',
      'Effect on the schedule (write “none” if none)',
      'Contractor — signed', 'Date',
      'Client — signed', 'Date',
      { note: 'This work does not start until both signatures are on this page.' },
    ],
  },
  {
    id: 'takeoff-sheet',
    title: 'Room takeoff sheet',
    file: 'trueline-takeoff.pdf',
    blurb:
      'Wall by wall, with the four areas kept apart — floor, ceiling, wall face and '
      + 'perimeter — so nothing gets priced off the wrong one.',
    guide: 'drywall-takeoff',
    fields: [
      'Job', 'Room', 'Date', 'Measured by',
      'Ceiling height', 'Wall thickness',
      { block: 'Walls — id / length / measured or scanned', lines: 8 },
      { block: 'Openings — kind / width / height / which wall', lines: 5 },
      'Perimeter', 'Floor area', 'Ceiling area',
      'Wall face (perimeter × height, less openings)',
      'Baseboard (perimeter less doors and cased openings)',
      { block: 'Notes', lines: 3 },
    ],
  },
  {
    id: 'damage-log',
    title: 'Water damage and moisture log',
    file: 'trueline-damage-log.pdf',
    blurb:
      'Dry standard at the top, then the same identified points every visit with the '
      + 'meter and scale recorded — so the log can actually be drawn as a curve.',
    guide: 'moisture-readings-log',
    fields: [
      'Property', 'Claim no.', 'Date of loss', 'Date found', 'Category', 'Class',
      { block: 'Source', lines: 2 },
      { block: 'Dry standard — material / reading / meter / scale', lines: 3 },
      { block: 'Affected area — wall / run / height affected / cut height', lines: 4 },
      { block: 'Readings — date / time / point / material / reading / meter / scale', lines: 12 },
      { block: 'Ambient — temperature / relative humidity', lines: 3 },
      { block: 'Equipment — placed / moved / removed', lines: 3 },
      { block: 'Notes', lines: 3 },
    ],
  },
];
