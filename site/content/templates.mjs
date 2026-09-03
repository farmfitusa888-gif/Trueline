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
 *
 * ## The one that is not a blank
 *
 * `cancellation-notice` is different from every other form here, and the
 * difference is the whole reason it can exist. Its words are not written in
 * this file: they come out of `core/src/cooling.ts`, which carries the
 * § 429.1(a) statement and the § 429.1(b) form of 16 CFR Part 429 in the
 * regulation's own language, with the citations beside them. This file supplies
 * the blanks and nothing else. See `tools/pdfs.mjs`.
 *
 * ## The one that is deliberately not here
 *
 * There is no blank lien waiver on this site, and there is not going to be one
 * written from memory. A lien waiver is an operative legal instrument, some
 * states prescribe the exact wording and will not give effect to any other, and
 * nobody here can check which. So what is offered instead is the half that is
 * not state-specific and is genuinely useful: a sheet for recording which
 * waivers were asked for, received and exchanged. It makes no legal claim and
 * waives nothing, and it says so on its face.
 */

/**
 * The shelves the templates page is divided into.
 *
 * Ten forms in one column is a directory. These are the four jobs somebody
 * comes here to do, and each form belongs to exactly one of them.
 */
export const TEMPLATE_GROUPS = [
  {
    id: 'estimating',
    title: 'Estimating and pricing',
    blurb: 'What the quantities are, what they cost, and what the client is agreeing to.',
  },
  {
    id: 'contracts',
    title: 'Contracts and paperwork',
    blurb: 'What changes after signing, and what has to be handed over at the table.',
  },
  {
    id: 'restoration',
    title: 'Restoration and claims',
    blurb: 'What an adjuster needs, recorded while you are standing in front of it.',
  },
  {
    id: 'closeout',
    title: 'Closeout',
    blurb: 'The last walk round, and the list that decides when a job is finished.',
  },
];

export const TEMPLATES = [
  {
    id: 'estimate-form',
    group: 'estimating',
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
    group: 'estimating',
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
    group: 'contracts',
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
    group: 'estimating',
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
    group: 'restoration',
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
  {
    id: 'cancellation-notice',
    group: 'contracts',
    title: 'Notice of right to cancel, in duplicate',
    file: 'trueline-cancellation-notice.pdf',
    /**
     * The only form on this site whose words are not this site's words.
     *
     * `kind: 'cooling'` sends it to a different builder in `tools/pdfs.mjs`,
     * which takes the § 429.1(a) statement and the § 429.1(b) paragraphs out of
     * `core/src/cooling.ts` — the regulation's own language, cited there — and
     * puts blank rules where § 429.1(c) says the seller has to fill something
     * in. Two pages, because the rule requires two copies: the buyer sends one
     * and keeps one.
     */
    kind: 'cooling',
    blurb:
      'The federal three-day notice, printed twice on one download because the rule '
      + 'requires two copies. The wording is the regulation’s, not ours.',
    guide: 'three-day-right-to-cancel',
  },
  {
    id: 'lien-waiver-log',
    group: 'contracts',
    title: 'Lien waiver exchange log',
    file: 'trueline-lien-waiver-log.pdf',
    /**
     * Not a waiver. See the note at the top of this file: a lien waiver is an
     * operative legal instrument, several states prescribe the wording, and
     * nobody here can check which — so this records the exchange rather than
     * performing it, and says so on the page.
     */
    blurb:
      'Who owes you a waiver, who you owe one to, and whether it arrived — before '
      + 'the payment goes out. A record sheet, not a waiver: it waives nothing.',
    guide: 'change-order',
    fields: [
      { note: 'THIS SHEET IS NOT A LIEN WAIVER AND WAIVES NOTHING. It is a record of which '
            + 'waivers were asked for and received.' },
      { note: 'Some states require a specific statutory form of waiver and give no effect to '
            + 'any other wording. ScanToBid does not know which state this job is in and has '
            + 'not checked. Get the form from your own state or your own attorney.' },
      'Job', 'Address of the work', 'Owner', 'General contractor',
      'Payment application no.', 'Period covered — from', 'to',
      { block: 'Asked of — party / trade / contract sum / paid to date / through what date',
        lines: 8 },
      { block: 'Received — party / kind of waiver / dated / through what date / filed where',
        lines: 8 },
      { block: 'Still outstanding when this payment went out — and why', lines: 4 },
      'Checked by', 'Date',
    ],
  },
  {
    id: 'scope-sheet',
    group: 'restoration',
    title: 'Room-by-room scope sheet',
    file: 'trueline-scope-sheet.pdf',
    blurb:
      'One room to a block: what is affected, what is being removed, what is being '
      + 'dried and what is going back — with the quantity beside each line.',
    guide: 'document-water-damage',
    fields: [
      'Property', 'Claim no.', 'Date of loss', 'Prepared by', 'Date',
      { note: 'One block per room. Copy this page as many times as the job has rooms.' },
      'Room', 'Dimensions — length / width / ceiling height',
      'Floor area', 'Ceiling area', 'Wall face', 'Baseboard run',
      { block: 'Affected — which surfaces, and how far up each wall', lines: 4 },
      { block: 'Remove — item / quantity / unit', lines: 6 },
      { block: 'Dry in place — item / quantity / unit', lines: 4 },
      { block: 'Replace — item / quantity / unit', lines: 6 },
      { block: 'Contents — moved out / moved on site / non-salvageable', lines: 3 },
      { block: 'Not included in this scope', lines: 3 },
      { note: 'Where did each quantity come from — a tape, a scan, or an estimate? Say so '
            + 'beside it. A number nobody measured looks exactly like one somebody did.' },
      { block: 'Notes', lines: 3 },
    ],
  },
  {
    id: 'photo-log',
    group: 'restoration',
    title: 'Adjuster photo log',
    file: 'trueline-photo-log.pdf',
    blurb:
      'Every photograph numbered, placed in a room, pointed in a direction and tied to '
      + 'what it is evidence of — so a folder of images becomes a document.',
    guide: 'adjusters-look-for',
    fields: [
      'Property', 'Claim no.', 'Date of loss', 'Photographed by', 'Camera or phone',
      { note: 'Number every photograph and use the same number in the file name. A picture '
            + 'nobody can place in a room is a picture that proves nothing.' },
      { block: 'No. / date / time / room / which wall or which way it faces / what it shows',
        lines: 16 },
      { block: 'Overviews — one of every room from the doorway, before anything moved',
        lines: 3 },
      { block: 'Readings photographed — meter on the surface, number legible', lines: 3 },
      { block: 'Missing, and why', lines: 3 },
    ],
  },
  {
    id: 'punch-list',
    group: 'closeout',
    title: 'Punch list and final walkthrough',
    file: 'trueline-punch-list.pdf',
    blurb:
      'Walked room by room with the client, every item owned by somebody and dated. '
      + 'Signed at the bottom by both, which is what makes it a list rather than a mood.',
    guide: 'remodeling-proposal',
    fields: [
      'Job', 'Address of the work', 'Client', 'Walked on', 'Walked by',
      { note: 'Walk it with the client, in the same order every time, and write the item down '
            + 'in front of them. A list made afterwards is a list that gets argued with.' },
      { block: 'No. / room / item / who owns it / due / done', lines: 18 },
      { block: 'Outside the contract — quoted separately before any of it starts', lines: 4 },
      { note: 'Anything on this page that was not in the signed scope is a change order, '
            + 'including the small ones. Especially the small ones.' },
      'Items agreed', 'Items disputed',
      { block: 'Disputed — what, and what each side says', lines: 3 },
      'Contractor — signed', 'Date',
      'Client — signed', 'Date',
      { note: 'Signing this says the list is complete as of today, not that the work on it '
            + 'is finished.' },
    ],
  },
];
