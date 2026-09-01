/**
 * Three explainers that only somebody doing this work needs.
 *
 * Separate from the four audience files because of what they have in common:
 * every one of them is written out of something that already exists in
 * `core/src`, and none of them says anything that is not in there.
 *
 *   - The three-day right to cancel is `core/src/cooling.ts`, where 16 CFR
 *     §§ 429.0, 429.1 and 429.2 are quoted with their citations and the
 *     business-day rule is worked out. Nothing on that page is a legal claim
 *     this file invented, and there is not a single state's rule on it, because
 *     nobody here can check one and a wrong one costs a contractor money.
 *   - The ESX page is `core/src/job-file.ts`, whose `NOT_AN_ESX` constant is
 *     quoted on the page word for word.
 *   - The takeoff formulas are `core/src/work.ts`, `zone.ts` and `takeoff.ts`,
 *     and the table of measures is generated from the engine at build time
 *     rather than typed, so the page cannot describe a quantity the app derives
 *     differently.
 *
 * Where one of them would be better with a fact nobody here has, it says which
 * fact is missing instead of filling it in.
 */
import { COOLING, EXAMPLE_SAID, MEASURE_ROWS, ROOM_FIGURES } from '../worked.mjs';

export const EXPLAINERS = [

{
  slug: 'three-day-right-to-cancel',
  audience: 'contractor',
  title: 'The three-day right to cancel, and the day almost everyone counts wrong',
  metaTitle: '3-Day Right to Cancel: 16 CFR 429 for Builders',
  description:
    'When the federal cooling-off rule bites on a home improvement contract, what '
    + 'you have to hand over at the table, and why Saturday counts as a business day.',
  keywords: ['three day right to cancel contractor', '16 CFR 429 home improvement',
             'notice of cancellation contractor', 'cooling off rule contractor',
             'three business days to cancel'],
  minutes: 12,
  standfirst:
    'It is not about vacuum cleaners. It bites on where the agreement was signed — '
    + 'and a proposal signed at a kitchen table is exactly the sale it covers.',
  blocks: [
    { h2: 'What the rule is, and why it reaches a remodeler' },
    { p: 'The Federal Trade Commission’s Cooling-Off Rule is 16 CFR Part 429, "Rule Concerning '
       + 'Cooling-off Period for Sales Made at Homes or at Certain Other Locations". It is '
       + 'almost always explained with a story about a door-to-door salesman, which is why '
       + 'most contractors have decided it is not about them.' },
    { p: 'What it actually turns on is <strong>where the buyer’s agreement is made</strong>. '
       + '§ 429.0(a) covers a sale of consumer goods or services where the seller personally '
       + 'solicits the sale — "including those in response to or following an invitation by '
       + 'the buyer" — and the buyer’s agreement or offer to purchase is made somewhere other '
       + 'than the seller’s place of business, naming the buyer’s residence first among the '
       + 'examples.' },
    { note: 'Read that clause again: <strong>"following an invitation by the buyer" is inside '
          + 'the definition, not an exception to it.</strong> The homeowner ringing you up and '
          + 'asking for a quote does not take the sale out of the rule. This is the single '
          + 'commonest thing contractors have backwards about it, because "door-to-door" '
          + 'sounds like cold calling.' },
    { p: 'Two exclusions in § 429.0(a) look like they save a remodeler and do not. The one for '
       + 'a buyer-initiated visit to repair or maintain something covers the buyer’s '
       + '<em>personal property</em>; a kitchen is real property. The one for transactions '
       + '"pertaining to the sale or rental of real property" is about selling a house, not '
       + 'remodelling one. A home improvement contract is a sale of services.' },

    { h2: 'When it bites, by where you signed and for how much' },
    { table: {
        head: ['Where the buyer signs', 'Purchase price', 'Federal notice owed?'],
        rows: [
          ['At the buyer’s home', '$25 or more', 'Yes'],
          ['At the buyer’s home', 'Under $25', 'No'],
          ['Anywhere else that is not your office — a job trailer, a coffee shop, '
            + 'a home show stand, their workplace', '$130 or more', 'Yes'],
          ['Anywhere else that is not your office', 'Under $130', 'No'],
          ['At your own permanent place of business', 'Any', 'No — it is not a '
            + 'door-to-door sale under this rule'],
        ] } },
    { p: 'The $130 figure is the one to check yourself against. The rule was written with $25 '
       + 'for both, the Commission raised the away-from-residence figure to $130, and a great '
       + 'deal of contractor advice still in circulation quotes the old number.' },
    { p: 'There are exclusions in § 429.0(a) that no app and no web page can see, because they '
       + 'depend on how the sale came about: a deal negotiated at your own permanent premises '
       + 'and merely signed later, a genuine emergency where the buyer has written and signed a '
       + 'waiver in their own hand, a sale arranged entirely by post or telephone with no other '
       + 'contact. If one of those fits, the notice may not be owed at all.' },

    { h2: 'What you have to hand over, and when' },
    { steps: [
        { h3: 'A completed copy, at the time of signing',
          p: '§ 429.1(a) wants a fully completed receipt or copy of the contract given at the '
           + 'time of its execution, in the same language as the sales presentation, showing '
           + 'the date of the transaction and the seller’s name and address. Not posted the '
           + 'next day. At the table.' },
        { h3: 'The statement, in ten point bold, beside the signature',
          p: 'In bold face type of a minimum size of ten points, in immediate proximity to the '
           + 'space for the buyer’s signature: "You, the buyer, may cancel this transaction at '
           + 'any time prior to midnight of the third business day after the date of this '
           + 'transaction."' },
        { h3: 'Two cancellation forms, attached and detachable',
          p: '§ 429.1(b) wants the form in duplicate, captioned either "NOTICE OF RIGHT TO '
           + 'CANCEL" or "NOTICE OF CANCELLATION", attached to the contract and easily '
           + 'detachable, in ten point bold face type. Two copies because the buyer sends one '
           + 'and keeps one — a single copy means a buyer who cancels has kept no evidence '
           + 'that he did.' },
        { h3: 'Filled in by you, not by them',
          p: '§ 429.1(c) makes completing both copies the seller’s job: the seller’s name, the '
           + 'address of the seller’s place of business, the date of the transaction, and the '
           + 'date — "not earlier than the third business day following the date of the '
           + 'transaction" — by which the buyer may give notice of cancellation.' },
      ] },
    { note: '<strong>Free download:</strong> the notice, in duplicate, with the regulation’s '
          + 'own wording and blanks where § 429.1(c) says you have to fill something in. It is '
          + 'generated from the same code the app uses. <a href="/templates/#contracts">Take '
          + 'it here.</a>' },

    { h2: 'The date, which is where it goes wrong' },
    { p: 'That last blank — the deadline — is the one a contractor must never work out in his '
       + 'head at the end of a two-hour sales call. It is midnight of the third business day '
       + 'after the transaction date, counting from the day <em>after</em> the sale, and the '
       + 'rule’s definition of a business day is not the definition anybody means by it.' },
    { p: '§ 429.0 says: "Business Day means any calendar day except Sunday or any federal '
       + 'holiday". That is the whole definition, and it has two consequences that catch '
       + 'people:' },
    { ul: [
        '<strong>Saturday is a business day.</strong> It counts. Almost every article written '
          + 'about this rule has it the other way round.',
        '<strong>Sunday is not, and neither is any federal holiday.</strong> The rule gives a '
          + 'list of examples in a parenthesis, but the words it uses are "any federal '
          + 'holiday" — so the list is the federal holidays, not those ten. Juneteenth became '
          + 'one in 2021, long after that parenthesis was written, and it is one.',
      ] },
    { p: `Worked through, on a week with no federal holiday in it and then on the week of `
       + 'Thanksgiving. Every date in this table is counted by the same code the app puts on a '
       + 'proposal — none of it is arithmetic done by hand for a web page:' },
    { table: {
        head: ['Signed on', 'The days counted', 'Buyer can cancel until midnight on'],
        rows: COOLING.rows.map((r) => [r.signed, r.counted, r.deadline]),
      } },
    { p: 'The third row is the one worth staring at. A sale signed on the Wednesday runs out on '
       + 'the <strong>Saturday</strong>, because Saturday is the third business day. And the '
       + 'last row is a holiday doing the same job a Sunday does — the Thursday drops out and '
       + 'the deadline moves to the Monday.' },
    { p: 'Which way you err matters, and it is not symmetrical. Treat Saturday as a '
       + 'non-business day and the deadline lands a day late, which is harmless. Treat Sunday '
       + 'as a business day and it lands a day early — and § 429.1(c) says the date must be '
       + '"not earlier than the third business day", so an early date is exactly the thing the '
       + 'rule forbids.' },
    { formula: 'deadline = the third day after the sale that is not a Sunday and not a federal holiday',
      note: 'Counting starts the day after the transaction. The day of the sale is never one of '
          + 'the three, whatever day of the week it is.' },

    { h2: 'What this page does not tell you, and will not' },
    { p: 'This is the federal rule only. Many states have home-solicitation or home-improvement '
       + 'contract laws of their own, several give the buyer longer than three days, and some '
       + 'require wording of their own. § 429.2 records that the Commission did not set out to '
       + 'preempt them.' },
    { p: '<strong>There is no state-by-state table on this page and there is not going to be '
       + 'one.</strong> Nobody here can verify fifty statutes, a list assembled from memory is '
       + 'exactly the kind of invented fact that ends up quoted back at somebody in a dispute, '
       + 'and a contractor who reads a confident three-day answer and never learns his state '
       + 'gives longer is worse off than one who was told to go and look. Whichever period is '
       + 'longer is the one that protects the buyer. Go and check yours.' },
    { p: 'This is not legal advice either. What it is, and all it is, is the text of a federal '
       + 'rule with the citations attached so you can read it yourself — and a way of counting '
       + 'a date that does not depend on anybody remembering that Saturday counts.' },

    { h2: 'Why it is in the app rather than on a checklist' },
    { p: 'Trueline works the deadline out rather than asking for it. The proposal knows where '
       + 'it was signed and what it is for, so it knows whether the rule bites; it counts the '
       + 'business days the federal way, Saturdays in and Sundays and federal holidays out; and '
       + 'it prints the notice and both cancellation forms with your name, your business '
       + 'address and that date already on them.' },
    { p: 'And when it cannot complete them — no business address on your profile, say — it '
       + 'refuses to print a form with a hole in it and says so on the document instead. A '
       + 'notice with a blank where the address goes tells a buyer to post his cancellation to '
       + 'nowhere, which is worse than none, because it looks like a notice.' },
  ],
  faq: [
    { q: 'Does the three-day right to cancel apply if the homeowner called me?',
      a: 'The phrase "including those in response to or following an invitation by the buyer" '
       + 'is inside the § 429.0(a) definition rather than an exception to it, so being invited '
       + 'does not by itself take the sale out of the rule. What the rule turns on is where the '
       + 'agreement was made and what it costs.' },
    { q: 'Is Saturday a business day for the three-day cancellation period?',
      a: 'Yes. § 429.0 defines a business day as any calendar day except Sunday or any federal '
       + 'holiday, so Saturday counts and Sunday does not. Getting this backwards in the '
       + 'direction that shortens the buyer’s three days is what § 429.1(c) forbids when it '
       + 'requires a date "not earlier than the third business day".' },
    { q: 'What has to be handed over at signing?',
      a: 'A fully completed copy of the contract or receipt, the cancellation statement in ten '
       + 'point bold beside the signature space, and two completed copies of the cancellation '
       + 'form attached to the contract and easily detachable. § 429.1(c) makes filling in the '
       + 'seller’s name, business address, transaction date and cancellation deadline the '
       + 'seller’s job rather than the buyer’s.' },
    { q: 'Does the rule apply to a job signed at my own office?',
      a: 'A sale where the buyer’s agreement is made at the seller’s main or permanent branch '
       + 'office is not a door-to-door sale under 16 CFR 429, so the federal notice is not '
       + 'required. Your state may still require one — this page does not know your state’s '
       + 'rule and does not pretend to.' },
    { q: 'What does my state require?',
      a: 'This page will not tell you, on purpose. Many states have their own '
       + 'home-solicitation laws, several give longer than three days, and a list written from '
       + 'memory would be the exact kind of made-up fact that costs somebody money. Look up '
       + 'your own state, and remember the longer period is the one that governs.' },
  ],
  related: ['remodeling-proposal', 'construction-estimate-template', 'change-order'],
  download: 'cancellation-notice',
},

{
  slug: 'esx-file-format',
  audience: 'restoration',
  title: 'What an ESX file actually is, and why nothing writes you one',
  metaTitle: 'ESX File Format: What It Is and Who Can Write One',
  description:
    'What an ESX carries, what it has no field for, and why a room-measuring app '
    + 'cannot simply write you one. Plus what to send an adjuster instead.',
  keywords: ['esx file format', 'write esx file', 'xactimate esx export',
             'esx schema', 'export sketch to xactimate'],
  minutes: 10,
  standfirst:
    'Every measuring app gets asked for an ESX export. The reason so few have one '
    + 'is not laziness, and knowing what the reason is tells you what to ask for instead.',
  blocks: [
    { h2: 'What the file is' },
    { p: 'ESX is Xactimate’s own format for moving an estimate between machines and between '
       + 'people. Underneath it is a compressed archive — a zip — holding the estimate’s '
       + 'structured data, which on a claim includes the sketch: the rooms, their dimensions '
       + 'and how they connect.' },
    { p: 'That last part is why anybody who has already measured a building with something else '
       + 'wants one. If the geometry can go in as data, nobody re-draws a room they already '
       + 'walked.' },

    { h2: 'Why an app you use cannot simply write one' },
    { p: 'Being a zip is not the same as being open. What is inside the zip is Verisk’s own '
       + 'schema, and that is where a "just export an ESX" feature request stops.' },
    { p: 'Trueline’s own source records the position it took, in the file that builds the job '
       + 'archive, and the sentence it prints inside every archive it makes is this:' },
    { note: 'This is not an .esx and Xactimate will not open it. ESX is Verisk’s own format; '
          + 'its schema is not published, and every tool that writes one has a partnership '
          + 'with Verisk to do it. Everything an ESX would carry is in here in formats anything '
          + 'can read — the drawing as DXF, the quantities as CSV, the claim as PDF and HTML, '
          + 'the photographs as they were taken.' },
    { p: 'The reason that sentence exists at all is the failure it prevents: a file that '
       + 'quietly is not an ESX is a file somebody emails to an adjuster expecting Xactimate to '
       + 'open it. Writing a speculative one and calling it an export would ship a file nobody '
       + 'can verify opens, which is worse than not having the button.' },
    { note: '<strong>What has not been verified here, said plainly.</strong> Nobody at Trueline '
          + 'has been shown a schema document by Verisk, and "there is no public schema" is a '
          + 'negative that cannot be proved from outside. What can be seen from outside is that '
          + 'tools which do write ESX describe the arrangement as a partnership — Roofr’s own '
          + 'page for it is titled "ESX Files for Xactimate | Roofr + Verisk Partnership", and '
          + 'magicplan publishes an Xactimate integration of its own. Both of those are search '
          + 'results seen rather than pages read, and neither says anything about what Verisk’s '
          + 'terms are. Treat the paragraph above as the reason a small app gives you for not '
          + 'having the feature, not as a statement of anybody’s licensing.' },

    { h2: 'What an ESX has no field for' },
    { p: 'This is the part worth sitting with, and it is true of every estimating format rather '
       + 'than a criticism of this one. There is nowhere in an estimate file to record that a '
       + 'wall was scanned and never checked.' },
    { p: 'Once geometry is inside an estimating package it is indistinguishable from geometry '
       + 'somebody put a tape on, and every quantity derived from it inherits that. The room '
       + 'that was guessed at and the room that was measured produce identically confident '
       + 'numbers, on identically professional paper.' },
    { p: 'So the discipline has to happen before the export, not after it. Settle which walls '
       + 'have had a tape on them, correct the ones that matter, and then send. After that, the '
       + 'information is simply gone.' },

    { h2: 'What to send instead, and why it is not a downgrade' },
    { p: 'Everything an ESX would carry exists in formats that need nobody’s permission. A job '
       + 'archive is one file to attach rather than an email with six things on it and a '
       + 'seventh forgotten:' },
    { table: {
        head: ['What it is', 'The format', 'What opens it'],
        rows: [
          ['The drawing', 'DXF', 'Every CAD package, and most estimating ones'],
          ['The quantities', 'CSV', 'A spreadsheet, or an estimating package’s importer'],
          ['The claim document', 'PDF and HTML', 'Anything at all'],
          ['The photographs', 'As they were taken', 'Anything at all'],
          ['What the archive holds, and what is missing from it', 'A manifest',
            'A text editor — it is the list of the other five'],
        ] } },
    { p: 'The manifest is the part that is not obvious and is the part that matters. It repeats '
       + 'the provenance caveat at a level above any single file in the archive — because '
       + 'somebody opens the CSV in a spreadsheet, prices off it, and never looks at the '
       + 'drawing the caveat was printed on. A caveat that travels with one file and not the '
       + 'others is a caveat somebody works around without meaning to.' },
    { p: 'It also carries, in writing, that the archive is not an ESX. Said out loud, in the '
       + 'file, because somebody will ask.' },

    { h2: 'What to check on anything that did import' },
    { steps: [
        { h3: 'Room names',
          p: 'They travel, and they are frequently whatever the capturing app called them. '
           + '"Room 3" is not a room name an adjuster can work with.' },
        { h3: 'Ceiling heights, on every room',
          p: 'The single value most likely to be a default rather than a measurement. Check all '
           + 'of them, not the first one.' },
        { h3: 'The opening count, against the actual room',
          p: 'A missed door is a deduction that never happens, on every quantity derived from '
           + 'that wall.' },
        { h3: 'Anything the capture had to guess at',
          p: 'Bays, curves, deep bulkheads. These are where an automated capture produces a '
           + 'clean, confident, wrong shape.' },
        { h3: 'Whether any of it was ever measured',
          p: 'Nothing in the file can tell you, so it has to come from you, and it has to be '
           + 'settled before the file leaves rather than after.' },
      ] },
  ],
  faq: [
    { q: 'What is an ESX file?',
      a: 'It is Xactimate’s own format for moving an estimate between machines and people. '
       + 'Underneath it is a compressed archive holding the estimate’s structured data, '
       + 'including the sketch — the rooms, their dimensions and how they connect.' },
    { q: 'Can any app export an ESX?',
      a: 'The tools that write one describe having an arrangement with Verisk to do it. That is '
       + 'the reason an app you use may tell you it cannot: writing a speculative file and '
       + 'calling it an export would produce something nobody can verify Xactimate will open, '
       + 'which is worse than not offering it.' },
    { q: 'Does an ESX record whether a wall was measured with a tape?',
      a: 'No. There is no field for it. Once geometry is inside an estimating package it looks '
       + 'exactly like geometry somebody measured, which is why the decision about what is '
       + 'trustworthy has to be made before the file is sent.' },
    { q: 'What should I send an adjuster if I cannot send an ESX?',
      a: 'The drawing as DXF, the quantities as CSV, the claim as PDF, the photographs as they '
       + 'were taken, and a manifest listing all of it. Every one of those opens without '
       + 'anybody’s software, and the manifest is where the caveat about what was and was not '
       + 'measured lives so that it cannot be lost by opening one file out of five.' },
  ],
  related: ['xactimate-esx-import', 'document-water-damage', 'adjusters-look-for'],
  download: null,
},

{
  slug: 'takeoff-formulas',
  audience: 'contractor',
  title: 'Every takeoff formula, and where each one gets its number',
  metaTitle: 'Takeoff Formulas: How Each Quantity Is Derived',
  description:
    'Floor, ceiling, wall face, baseboard, openings, framing and returns — the exact '
    + 'derivation of each, which openings come off which, and where the errors hide.',
  keywords: ['takeoff formulas', 'construction takeoff calculations',
             'wall face formula', 'how to calculate baseboard linear feet',
             'quantity takeoff derivation'],
  minutes: 12,
  standfirst:
    'Six quantities, one room. What separates a takeoff that survives a dispute from '
    + 'one that does not is knowing which openings come off which line — and none off some.',
  blocks: [
    { h2: 'The room is a walk, and everything else falls out of it' },
    { p: 'Before any quantity there is one thing: the walk. A run, a turn, a run, a turn, back '
       + 'to where you started. Every corner is where the previous run left you, and the '
       + 'polygon that closes is the room.' },
    { p: 'Floor area is the shoelace formula over those corners — not width times depth, which '
       + 'is only right when the room happens to be a box. Perimeter is the runs added up. '
       + 'Everything below is those two numbers with something taken off.' },
    { p: 'If the walk does not close, none of it means anything, and that is worth finding out '
       + 'first. <a href="/calculators/odd-shaped-room/">The odd-shaped room calculator</a> '
       + 'walks a room and says how far out it finished.' },

    { h2: 'The four a room produces on its own' },
    { table: {
        head: ['Quantity', 'Derivation', 'Unit'],
        rows: [
          ['Floor', 'the shoelace formula over the corners the walk lands on', 'sq ft'],
          ['Ceiling', 'follows the floor outline exactly', 'sq ft'],
          ['Wall face', 'built walls × their height, less every door, window and cased opening',
            'sq ft'],
          ['Baseboard', 'built walls less doors and cased openings; it runs under a window',
            'lf'],
        ] } },
    { p: 'Two things in that table are doing more work than they look like they are.' },
    { p: '<strong>"Built walls."</strong> A side of a room with nothing across it — a garage '
       + 'door opening, a wide span into the next room — bounds the floor and the ceiling and '
       + 'closes the polygon, and it carries no drywall, no paint and no baseboard. It is an '
       + 'open span, it is priced at nothing, and it appears on the sheet as its own line so '
       + 'that nobody finds out about it from a delivery.' },
    { p: '<strong>"Less every door, window and cased opening" — but not the same ones on each '
       + 'line.</strong> That is the sentence this whole page exists for.' },

    { h2: 'Which openings come off which' },
    { table: {
        head: ['', 'Wall face', 'Baseboard', 'Floor and ceiling'],
        rows: [
          ['Door', 'Comes off — width × height', 'Comes off — its width', 'No effect'],
          ['Cased opening', 'Comes off — width × height', 'Comes off — its width', 'No effect'],
          ['Window', 'Comes off — width × height', '<strong>Stays</strong> — base runs '
            + 'underneath it', 'No effect'],
        ] } },
    { p: 'Subtracting windows from the base run is the second commonest arithmetic error in a '
       + 'takeoff, and it always goes the same way: short. The commonest is pricing board off '
       + 'the floor area.' },
    { p: `On a room ${EXAMPLE_SAID.width} × ${EXAMPLE_SAID.depth} at `
       + `${EXAMPLE_SAID.height}, with one ${EXAMPLE_SAID.doorWidth} × `
       + `${EXAMPLE_SAID.doorHeight} door and one ${EXAMPLE_SAID.windowWidth} × `
       + `${EXAMPLE_SAID.windowHeight} window, that is the difference between four numbers:` },
    { table: {
        head: ['', 'Figure'],
        rows: [
          ['Floor, and ceiling', `${ROOM_FIGURES.floorArea} sq ft`],
          ['Perimeter', `${ROOM_FIGURES.perimeter} lf`],
          ['Wall face before any deduction', `${ROOM_FIGURES.wallFaceGross} sq ft`],
          ['Wall face, door and window off', `${ROOM_FIGURES.wallFace} sq ft`],
          ['Baseboard — door off, window not', `${ROOM_FIGURES.baseboard} lf`],
        ] } },
    { p: 'Quote the floor figure for board and you are short by a factor of more than two. '
       + 'Subtract the window from the base and you are short by its width, on every room in '
       + 'the house.' },

    { h2: 'Every way the app measures a surface' },
    { p: 'These are the app’s own measures, and the sentence beside each one is the sentence it '
       + 'prints under that line on a takeoff. This table is generated from the engine rather '
       + 'than written here, so it cannot describe a quantity differently from the way the app '
       + 'derives it.' },
    { table: {
        head: ['Measure', 'Unit', 'On', 'What comes off it'],
        rows: MEASURE_ROWS.map((m) => [m.label, m.unit, m.surfaces, m.workings]),
      } },
    { note: 'The last row is the honest one. Some things on a job are not measured off a room '
          + 'at all — a dumpster, a day, a permit — and a number typed by hand does not move '
          + 'when the room does. The sheet says so on that line rather than letting it pass for '
          + 'a quantity somebody derived.' },

    { h2: 'The quantities that need a wall thickness' },
    { p: 'Four more come out of the room only once somebody has said how thick the walls are, '
       + 'and every one of them is unorderable without it:' },
    { ul: [
        '<strong>Jamb depth</strong> — the wall thickness plus a sixteenth. One per wall '
          + 'thickness rather than one per room: an average would be right for some openings '
          + 'and send the wrong pre-hung unit for the rest.',
        '<strong>Opening wrap</strong> — the board that returns into the reveal. Its area is '
          + 'the reveal’s perimeter times the thickness. Two jambs and a head on a door; a '
          + 'sill as well on a window, because a door has the floor running through it.',
        '<strong>Plates and studs</strong> — three times the framed run for plates, one bottom '
          + 'and two top, and field studs at the spacing plus one at each end of each wall.',
        '<strong>Outside footprint</strong> — the inside area plus the wall thickness all the '
          + 'way round, which is what a slab, a roof and a permit sketch are measured on.',
      ] },
    { note: 'A wall with no thickness given contributes to none of those, and the takeoff names '
          + 'it rather than assuming four and a half inches. That matters more than it sounds: '
          + 'a block garage priced as stud framing reconciles perfectly and is wrong, and a '
          + 'sheet missing the framing for three walls also adds up perfectly.' },

    { h2: 'Where the errors actually live' },
    { steps: [
        { h3: 'The perimeter, four inches out',
          p: 'Four inches over four walls moves the wall face by more than ten square feet, and '
           + 'nothing about the resulting number looks wrong. It is as authoritative as a '
           + 'correct one.' },
        { h3: 'The ceiling height, taken once',
          p: 'It multiplies the perimeter, so it multiplies the error, and in an old house it '
           + 'is different in the next room.' },
        { h3: 'A window taken off the base run',
          p: 'Short by the window width, every time, on every room with glass in it.' },
        { h3: 'An opening deducted with no return added',
          p: 'The wall face is right and the board order is short by the wrap. On a job with a '
           + 'lot of doors this is real money.' },
        { h3: 'Two collinear walls entered as one',
          p: 'A wall written twice, or a real angle recorded as square. Either way the walk '
           + 'stops closing, which is the one error a takeoff can catch on its own.' },
      ] },

    { h2: 'Why the sheet says where the numbers came from' },
    { p: 'Every formula above is exact arithmetic on exact integers — lengths in whole '
       + 'nanometres, areas in whole square nanometres, money in whole cents — so nothing is '
       + 'ever rounded until the moment it is printed for a person to read. That removes one '
       + 'class of error completely.' },
    { p: 'It does nothing at all about the other one. A perfectly derived quantity from a wall '
       + 'nobody measured is a perfectly derived guess, and by the time it is a line on a '
       + 'client’s proposal nothing on the paper says which it was. Which is why every length '
       + 'in Trueline carries how it was arrived at — scanned, drawn, or measured with a tape — '
       + 'right through onto the document somebody signs.' },
    { p: 'Run any of these on your own room: <a href="/calculators/">the calculators</a> '
       + 'use this exact code, in your browser, on figures you type.' },
  ],
  faq: [
    { q: 'What is the formula for wall face area?',
      a: 'The perimeter of the built walls times the ceiling height, less the area of every '
       + 'door, window and cased opening. Floor area has nothing to do with it, and a side of '
       + 'the room with no wall built across it contributes nothing.' },
    { q: 'Do windows come off the baseboard run?',
      a: 'No. Baseboard runs underneath a window, so only doors and cased openings interrupt '
       + 'it. Windows do come off the wall face, which is why the two lines deduct different '
       + 'openings from the same perimeter.' },
    { q: 'How is floor area calculated for a room that is not rectangular?',
      a: 'By the shoelace formula over the corners the walk lands on. It handles an L, a U, a '
       + 'bay and an angled wall without being told which of them it has, and it is exact — '
       + 'width times depth is only correct when the room is genuinely a box.' },
    { q: 'What is an opening return, and why does it need a wall thickness?',
      a: 'It is the board or trim that wraps through the wall into the jamb. Its area is the '
       + 'perimeter of the reveal times the thickness of the wall, so without a thickness there '
       + 'is no number — and guessing one would price a block wall as stud framing while the '
       + 'sheet still reconciled.' },
    { q: 'Why keep the ceiling separate from the walls?',
      a: 'Because they are boarded differently, finished differently and frequently hung by '
       + 'different people. A combined figure cannot be priced against either trade’s rate, and '
       + 'once combined it cannot be taken apart again.' },
  ],
  related: ['drywall-takeoff', 'square-footage-vs-wall-area', 'measure-baseboard-trim'],
  download: 'takeoff-sheet',
},

];
