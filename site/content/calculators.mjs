/**
 * The calculators, as data.
 *
 * Same shape as a guide — metadata, blocks, questions, related pages — with two
 * additions: `calc`, which names the function in `site/src/calc/engine.mjs`
 * that the form on the page runs, and `form`, which is the fields it asks for.
 *
 * ## The line these pages hold
 *
 * Everything here is written for somebody who does this work for money. There
 * is no page called "what does drywall cost", because the person who types that
 * is hiring a contractor rather than being one. "Markup vs margin" brings
 * exactly one kind of visitor. That is the whole editorial rule.
 *
 * ## And the line the numbers hold
 *
 * Nothing in this file is a figure. Every number that appears on a calculator
 * page comes from `content/worked.mjs`, which computes it with the engine at
 * build time. Where a page would be better with a number nobody here has — what
 * a room wastes, what a gallon covers, what a stick of base costs — the page
 * says so and asks for it, rather than filling it in.
 */
import {
  BASEBOARD,
  DRYWALL,
  EXAMPLE_SAID,
  MARKUP,
  ODD_ROOM,
  PAINT,
  ROOM_FIGURES,
} from './worked.mjs';

/** The room the drywall, paint and trim pages all work on, said in one line. */
const THE_ROOM =
  `${EXAMPLE_SAID.width} × ${EXAMPLE_SAID.depth} with a ${EXAMPLE_SAID.height} ceiling, `
  + `one ${EXAMPLE_SAID.doorWidth} × ${EXAMPLE_SAID.doorHeight} door and one `
  + `${EXAMPLE_SAID.windowWidth} × ${EXAMPLE_SAID.windowHeight} window`;

/**
 * The fields that describe a room. Shared, because it is the same room.
 *
 * Every box opens filled in with the example the page works through underneath
 * it, so the figures in the form and the figures in the prose are one set of
 * numbers that a reader can watch move.
 */
const ROOM_FIELDS = [
  { shape: true, width: EXAMPLE_SAID.width, depth: EXAMPLE_SAID.depth },
  {
    text: 'height',
    label: 'Ceiling height',
    hint: 'Feet and inches or millimetres — 8’, 8’ 1 1/2”, 97” and 2450mm all read.',
    prefill: EXAMPLE_SAID.height,
  },
  {
    openings: true,
    prefill: {
      doors: '1',
      doorWidth: EXAMPLE_SAID.doorWidth,
      doorHeight: EXAMPLE_SAID.doorHeight,
      windows: '1',
      windowWidth: EXAMPLE_SAID.windowWidth,
      windowHeight: EXAMPLE_SAID.windowHeight,
    },
  },
];

export const CALCULATORS = [

{
  slug: 'markup-vs-margin',
  calc: 'markup',
  title: 'Markup and margin are not the same number',
  metaTitle: 'Markup vs Margin Calculator, With the Sums',
  description:
    `A ${MARKUP.markup}% markup leaves a ${MARKUP.margin}% margin, not ${MARKUP.markup}%. `
    + 'Convert either way, see the division each figure is, and find the markup a target '
    + 'margin needs.',
  keywords: ['markup vs margin', 'markup to margin calculator', 'contractor margin calculator',
             'what markup for 30 percent margin', 'gross margin construction'],
  minutes: 7,
  standfirst:
    'Two words for two different divisions. Charge a markup and call it a margin and '
    + 'you are short on every job, by a gap that widens the more you add.',
  blocks: [
    { h2: 'The two divisions' },
    { p: 'Both numbers are the same dollars of profit over a different bottom half. That is '
       + 'the entire difference, and it is worth writing out once:' },
    { formula: 'markup = profit ÷ <strong>cost</strong>',
      note: 'What you add on top of what the job costs you.' },
    { formula: 'margin = profit ÷ <strong>price</strong>',
      note: 'What share of the money coming in you actually keep.' },
    { p: `A job costs ${MARKUP.cost}. Add ${MARKUP.markup}% and you charge ${MARKUP.price}, `
       + `so the profit is ${MARKUP.profit}. Now divide it two ways:` },
    { formula: `${MARKUP.markupWorking}<br>${MARKUP.marginWorking}` },
    { p: `Same job, same ${MARKUP.profit}, and two answers: ${MARKUP.markup}% and `
       + `${MARKUP.margin}%. The markup divides by the cost, which is the smaller of the two `
       + 'bottom halves, so it always reads higher than the margin it leaves. Every time.' },

    { form: true },

    { h2: 'What each markup actually leaves' },
    { p: `The whole table, on a job costing ${MARKUP.costWorked}. Read across: the figure you `
       + 'add, and the share of the invoice you keep after adding it.' },
    { table: {
        head: ['Markup on cost', 'You charge', 'Profit', 'Margin'],
        rows: MARKUP.table.map((r) => [r.markup, r.price, r.profit, r.margin]),
      } },
    { p: 'The gap is not a constant, which is what makes this expensive rather than merely '
       + 'untidy. It widens as the markup goes up, so the contractor who thinks he is doing '
       + 'better than most is the one furthest out.' },

    { h2: 'Going the other way, which is the useful direction' },
    { p: 'Nobody sets out to hit a markup. What a contractor decides is what he needs to keep '
       + 'out of every dollar that comes in — that is a margin — and then has to work out what '
       + 'to add to a cost to land on it.' },
    { formula: 'markup = margin ÷ (1 − margin)' },
    { table: {
        head: ['Margin you want to keep', 'Markup you have to add'],
        rows: MARKUP.wanted.map((r) => [r.margin, r.markup]),
      } },
    { note: 'The row that costs the most money is the third one. A contractor who wants to '
          + 'keep a fifth of every dollar has to add a quarter, and adding a fifth instead is '
          + 'the single commonest way a busy year ends with nothing in it.' },

    { h2: 'Where this sits in a price' },
    { p: 'Neither figure decides what a job should cost. The cost comes first — your own '
       + 'labour rate, your own material prices, the quantities the room actually measures — '
       + 'and the markup goes on top of that. A margin applied to a cost nobody worked out is '
       + 'a percentage of a guess.' },
    { p: 'That is the order ScanToBid works in and the reason it holds a rate book rather than '
       + 'a price list: quantities come off the room, rates come off the book you typed, and '
       + 'the job markup is one number applied at the end where you can see it. There is no '
       + 'market data in it, because a national average is not what anybody here charges.' },
    { p: 'The arithmetic on this page is the app’s own — it is <code>quote()</code> from the '
       + 'pricing module, the same function that puts a total on a proposal, run in your '
       + 'browser on the figures you type. Nothing is sent anywhere.' },
  ],
  faq: [
    { q: 'Is a 30% markup the same as a 30% margin?',
      a: `No. A ${MARKUP.markup}% markup on a ${MARKUP.cost} cost gives a ${MARKUP.price} `
       + `price and ${MARKUP.profit} of profit, and ${MARKUP.profit} out of ${MARKUP.price} `
       + `is a ${MARKUP.margin}% margin. Markup divides the profit by the cost; margin `
       + 'divides it by the price. The margin is always the smaller of the two.' },
    { q: 'What markup do I need for a 30% margin?',
      a: `${MARKUP.markupForThirty}%. The formula is the margin divided by one minus the `
       + 'margin, so 0.30 ÷ 0.70. Anything less than that and the margin lands under thirty.' },
    { q: 'Which one should I be quoting in?',
      a: 'Price in whichever your own numbers are kept in, and be certain which that is. The '
       + 'trap is not preferring one — it is a spreadsheet whose column heading says margin '
       + 'and whose formula adds a markup, because nothing on the screen ever says so.' },
    { q: 'Does overhead go in the markup or the margin?',
      a: 'That is a decision about your own books rather than an arithmetic question, and it '
       + 'is why this page will not answer it for you. What matters is that overhead is in '
       + 'one of them and only one: counted in the cost before the markup, or covered out of '
       + 'the margin after it. Counted twice and you are dear; counted in neither and you are '
       + 'working for nothing.' },
  ],
  form: [
    { money: 'cost', label: 'What the job costs you', hint: 'Labour, materials, subs — everything you pay out.', prefill: '10000' },
    { text: 'markup', label: 'Markup you add', hint: 'A percentage. Write 30 or 30.5.', prefill: '30' },
    { text: 'targetMargin', label: 'Margin you want to keep (optional)', hint: 'Fill this in and it works out the markup that lands on it.' },
  ],
  related: {
    calculators: ['drywall-sheets', 'odd-shaped-room'],
    guides: ['contractor-rate-book', 'construction-estimate-template', 'price-a-kitchen-remodel'],
  },
},

{
  slug: 'drywall-sheets',
  calc: 'drywall',
  title: 'How many sheets of drywall a room takes',
  metaTitle: 'Drywall Sheet Calculator: Sheets for a Room',
  description:
    'Sheets for a room by sheet size, with every door, window and cased opening '
    + 'deducted, the ceiling counted separately and your own waste figure on top.',
  keywords: ['drywall sheet calculator', 'how many sheets of drywall', 'drywall calculator by room',
             'sheetrock quantity calculator', 'drywall takeoff calculator'],
  minutes: 8,
  standfirst:
    'Wall face less every opening, plus the ceiling if you are boarding it, over the '
    + 'size of sheet you are hanging. Rounded up, because you cannot buy nine tenths of one.',
  blocks: [
    { h2: 'What it counts, in the order it counts it' },
    { p: 'Board is priced off wall face, and wall face is the perimeter times the ceiling '
       + 'height — never the floor area. Then every door, window and cased opening comes out '
       + 'of it, because each one is board nobody buys.' },
    { formula: 'wall face = perimeter × ceiling height − every opening' },
    { p: `On a room ${THE_ROOM}: ${ROOM_FIGURES.perimeter} lf of perimeter at 8 ft is `
       + `${ROOM_FIGURES.wallFaceGross} sq ft, and the door and the window take it to `
       + `${ROOM_FIGURES.wallFace} sq ft. The ceiling follows the floor outline exactly — `
       + `${ROOM_FIGURES.ceilingArea} sq ft — and is kept on its own line, because it is `
       + 'boarded differently, finished differently and frequently hung by somebody else.' },

    { form: true },

    { h2: 'The same room, in every sheet size' },
    { p: `${DRYWALL.boardArea} sq ft of board — walls and ceiling together — divided by what `
       + `each size covers, rounded up. The last column adds a ${DRYWALL.wasteShown}% waste `
       + 'figure so the shape of the effect is visible: a tenth more board is not a tenth more '
       + 'sheets, because sheets round up. It is not a recommendation, and the calculator above '
       + 'leaves that box empty on purpose.' },
    { table: {
        head: ['Sheet', 'Covers', 'Sheets', `With ${DRYWALL.wasteShown}% waste`],
        rows: DRYWALL.table.map((r) => [r.sheet, r.covers, r.sheets, r.withWaste]),
      } },
    { p: `Walls only, no ceiling, in ${DRYWALL.table[0].sheet}: ${DRYWALL.wallsOnly} sheets. `
       + 'The bigger the sheet the fewer the joints, which is the actual reason to hang twelves '
       + 'in a room that will take them — the sheet count is the smaller half of the argument.' },

    { h2: 'Waste is a fact about the room, so you type it' },
    { p: 'This page will not pick a waste figure for you. A plain rectangle with two openings '
       + 'wastes very little; a room with three closets, a bulkhead and a bay window wastes a '
       + 'great deal, and neither of those is something a form can see.' },
    { p: 'The discipline that actually works is picking a figure, using it on every job, and '
       + 'moving it when a job runs short. A constant nobody ever revisits teaches you nothing '
       + 'and a figure invented on a website teaches you less.' },

    { h2: 'The board that wraps into the jambs' },
    { p: 'Deducting an opening and then forgetting the return is how a takeoff comes out short '
       + 'on a job with a lot of doors. The return is the strip of board that wraps through the '
       + 'wall into the jamb, and its area is the reveal’s perimeter times the wall thickness — '
       + 'which is why the calculator asks for a thickness and why it says nothing at all about '
       + 'returns when you leave that box empty.' },
    { p: `On the example room, at 4½ inch walls, the door and the window carry `
       + `${DRYWALL.wrap} sq ft of wrap between them. It is not guessed at four and a half `
       + 'inches when nobody has said: a block wall priced as stud framing reconciles perfectly '
       + 'and is wrong, which is the worst way for a number to be wrong.' },

    { h2: 'Where the perimeter has to come from' },
    { p: 'Everything above rests on the perimeter and the ceiling height being right. Four '
       + 'inches out over four walls moves the wall face by more than ten square feet, and '
       + 'nobody notices, because a wrong number looks exactly as authoritative as a right one.' },
    { p: 'That is what ScanToBid is for. The phone finds the shape of the room in about ninety '
       + 'seconds; a tape on one wall running each way is what turns that shape into numbers '
       + 'you can put on a document. Until it has, every sheet the app prints says SCANNED '
       + 'across it, where the client will read it.' },
  ],
  faq: [
    { q: 'Do you deduct doors and windows when counting drywall sheets?',
      a: 'Yes. Every door, window and cased opening is board nobody buys, and this calculator '
       + 'takes all three out of the wall face. What it does not do is let you forget the '
       + 'return — the board that wraps into the jamb — which is why it asks for the wall '
       + 'thickness.' },
    { q: 'Should the ceiling be in the same number as the walls?',
      a: 'Count it, but keep it apart. Ceiling area follows the floor outline and wall face '
       + 'follows the perimeter times the height. They are boarded differently, finished '
       + 'differently and often subcontracted separately, so a single combined figure cannot '
       + 'be priced properly.' },
    { q: 'How much waste should I add?',
      a: 'This page will not tell you, because how much a room wastes is a fact about the room '
       + 'and nobody here has seen yours. Pick a figure, put it in the box, use the same one on '
       + 'every job, and change it when a job runs short.' },
    { q: 'Is drywall estimated by the sheet or by the square foot?',
      a: 'Both, in that order. Work the area out in square feet from the perimeter and the '
       + 'ceiling height, then divide by the size you are hanging and round up. Pricing per '
       + 'square foot and ordering per sheet is ordinary.' },
  ],
  form: [
    ...ROOM_FIELDS,
    { select: 'sheet', label: 'Sheet size',
      options: [
        { value: '4x8', label: '4 ft × 8 ft' },
        { value: '4x9', label: '4 ft × 9 ft' },
        { value: '4x10', label: '4 ft × 10 ft' },
        { value: '4x12', label: '4 ft × 12 ft' },
        { value: '4x16', label: '4 ft × 16 ft' },
      ] },
    { check: 'ceiling', label: 'Board the ceiling as well', on: true },
    { text: 'waste', label: 'Waste (optional)', hint: 'Your own figure, as a percentage. Left empty, none is added.' },
    { text: 'thickness', label: 'Wall thickness (optional)',
      hint: 'Give one and the board wrapping into the jambs is counted too.',
      prefill: EXAMPLE_SAID.thickness },
  ],
  related: {
    calculators: ['paint', 'baseboard-trim', 'odd-shaped-room'],
    guides: ['drywall-takeoff', 'square-footage-vs-wall-area', 'measure-water-damaged-drywall'],
  },
},

{
  slug: 'paint',
  calc: 'paint',
  title: 'How much paint a room takes, coat by coat',
  metaTitle: 'Paint Calculator: Gallons by Coat and Coverage',
  description:
    'Gallons for a room from the wall face less every opening, the number of coats '
    + 'and the coverage rate printed on your own tin. No assumed coverage figure.',
  keywords: ['paint calculator by coverage', 'how many gallons of paint for a room',
             'paint takeoff calculator', 'paint coverage per gallon calculator',
             'painting estimate square footage'],
  minutes: 7,
  standfirst:
    'Wall face less every opening, times the coats, over the square feet a gallon '
    + 'covers. The third number is on the tin, and this page will not invent it.',
  blocks: [
    { h2: 'Three numbers, and only one of them is on the wall' },
    { formula: 'gallons = (wall face − openings) × coats ÷ coverage per gallon' },
    { p: 'The first is geometry and this calculator works it out. The second is a decision '
       + 'you make standing in the room. The third is a property of a product — it is printed '
       + 'on the can, it is different for a primer, and it is different again over bare board — '
       + 'so it is a box you fill in rather than a figure anybody here can supply.' },
    { p: 'Every paint calculator that quietly assumes a coverage rate is putting a made-up '
       + 'number underneath somebody’s material order. This one asks.' },

    { form: true },

    { h2: 'Worked, on a room with the openings taken out' },
    { p: `Take the room ${THE_ROOM}, and say the tin says ${PAINT.coverage} square feet to the `
       + 'gallon — read your own off the can rather than using that one.' },
    { table: {
        head: ['', 'Square feet'],
        rows: [
          ['Wall face, less the door and the window', PAINT.wallFace],
          ['One coat', PAINT.onePass],
          ['Two coats', PAINT.twoCoats],
        ],
      } },
    { formula: `${PAINT.twoCoats} ÷ ${PAINT.coverage} = ${PAINT.gallons} gal`,
      note: `Which is ${PAINT.buy} gallons off the shelf, and some of the last one left over.` },
    { p: `Roll the ceiling in as well and the two coats become ${PAINT.withCeilingArea} sq ft, `
       + `${PAINT.withCeilingGallons} gallons, ${PAINT.withCeilingBuy} to buy. Ceiling paint is `
       + 'usually a different product at a different coverage, so on a real job it is a second '
       + 'sum rather than a bigger version of the first one.' },

    { h2: 'What the openings do, and what they do not' },
    { p: 'Doors, windows and cased openings all come out of the wall face, exactly as they do '
       + 'for board — a hole in a wall takes no paint. What they add back is cutting-in time, '
       + 'and that is labour rather than material: a room with six windows takes about the same '
       + 'paint as a room with one and considerably longer.' },
    { note: 'This calculator counts material. It says nothing about hours, because how long a '
          + 'room takes depends on the crew, the finish, the colour change and whether anybody '
          + 'has to mask a floor — and none of those is something a room’s geometry knows.' },

    { h2: 'Primer is its own sum' },
    { p: 'Primer covers at its own rate and often at a worse one, especially over new board or '
       + 'over a stain being blocked. Run the calculator twice: once at the primer’s coverage '
       + 'for one coat, once at the finish’s for however many coats you are putting on. Adding '
       + 'a coat at the finish’s coverage rate and calling it primer is short by whatever the '
       + 'gap between the two products is.' },

    { h2: 'Where the wall face comes from' },
    { p: 'Painting is priced off the same wall face as drywall, which means it is only as good '
       + 'as the perimeter and the ceiling height behind it. ScanToBid takes both off the room '
       + 'itself and keeps every length’s provenance visible — scanned, drawn or measured — '
       + 'right onto the document a client reads, so a paint number nobody has taped says so on '
       + 'its face.' },
  ],
  faq: [
    { q: 'How many square feet does a gallon of paint cover?',
      a: 'Read it off the can. It is a property of the product, it differs between primer and '
       + 'finish, and it differs again over bare drywall. This calculator asks you for the '
       + 'figure instead of assuming one, because an assumed coverage rate is an invented '
       + 'number sitting underneath a material order.' },
    { q: 'Do you subtract doors and windows when estimating paint?',
      a: 'Yes, from the material. A hole in a wall takes no paint, so every door, window and '
       + 'cased opening comes out of the wall face. What openings add is cutting-in time, and '
       + 'that belongs in the labour line rather than the gallons.' },
    { q: 'Should the ceiling be in the same calculation as the walls?',
      a: 'Only if it is the same paint. Ceiling paint is usually a different product at a '
       + 'different coverage rate, so run it as a second sum. The checkbox above adds the '
       + 'ceiling area to the walls for the case where it genuinely is one product.' },
    { q: 'How do I allow for primer?',
      a: 'Run it separately, at the primer’s own coverage, for the number of primer coats. '
       + 'Adding a coat at the finish coat’s coverage rate leaves you short by whatever the '
       + 'difference between the two products is, which over a whole house is gallons.' },
  ],
  form: [
    ...ROOM_FIELDS,
    { text: 'coats', label: 'Coats', hint: 'A whole number.', prefill: '2' },
    { text: 'coverage', label: 'Coverage, square feet per gallon',
      hint: 'Off the can. ScanToBid does not know what you are painting with, so this box '
          + 'starts empty.' },
    { check: 'ceiling', label: 'Paint the ceiling with the same product' },
  ],
  related: {
    calculators: ['drywall-sheets', 'baseboard-trim', 'odd-shaped-room'],
    guides: ['square-footage-vs-wall-area', 'drywall-takeoff', 'contractor-rate-book'],
  },
},

{
  slug: 'baseboard-trim',
  calc: 'trim',
  title: 'Baseboard and trim, in linear feet',
  metaTitle: 'Baseboard Calculator: Linear Feet, Doors Off',
  description:
    'The run of base in a room: perimeter less every door and cased opening, with '
    + 'windows left in because base runs under them, and a stick count if you want one.',
  keywords: ['baseboard calculator', 'linear feet of baseboard', 'trim takeoff calculator',
             'how much baseboard for a room', 'baseboard linear footage'],
  minutes: 6,
  standfirst:
    'Base is the perimeter less the doors. Not less the windows — and subtracting '
    + 'those is the second commonest arithmetic error in a takeoff. It always goes short.',
  blocks: [
    { h2: 'What comes off, and what does not' },
    { formula: 'baseboard = perimeter − door widths − cased opening widths' },
    { p: 'A door interrupts the base and a cased opening interrupts the base. A window does '
       + 'not: the run carries on underneath it, and taking windows off is how a trim order '
       + 'arrives short on a room with a lot of glass.' },
    { p: `On a room ${THE_ROOM}: ${BASEBOARD.perimeter} lf of perimeter, `
       + `${BASEBOARD.deducted} lf out for the door, ${BASEBOARD.run} lf of base. The window `
       + 'changes nothing.' },

    { form: true },

    { h2: 'Sticks are not linear feet' },
    { p: `${BASEBOARD.run} lf in ${BASEBOARD.stock} ft lengths is `
       + `${BASEBOARD.sticks} sticks by division, and division is all a calculator can do here. `
       + 'Where the joins land, how many scarfs the walls force and what every mitre eats are '
       + 'decisions made against the wall, and no room’s geometry knows any of them.' },
    { p: 'Which is why the stick count on this page is optional and why the number that matters '
       + 'is the run. Order against the run and your own habit; use the stick count as a sanity '
       + 'check on what comes off the truck.' },
    { note: 'Long walls are where the count and reality part company. A 22 ft wall in 16 ft '
          + 'stock is two pieces and a scarf joint whichever way you cut it, and the division '
          + 'does not know the wall was 22 ft.' },

    { h2: 'The same run prices four different things' },
    { p: 'Base, shoe, cap and any other run that follows the floor all come off the same '
       + 'number. Crown does not — crown follows the ceiling line, which includes the door '
       + 'openings the base skips, so it is the perimeter rather than the base run.' },
    { table: {
        head: ['Run', 'Follows', 'Doors deducted?'],
        rows: [
          ['Baseboard', 'the floor line', 'Yes'],
          ['Shoe or quarter round', 'the base', 'Yes'],
          ['Chair rail', 'the wall, at height', 'Yes — it stops at a cased opening'],
          ['Crown', 'the ceiling line', 'No — it runs over the door'],
        ],
      } },
    { p: `That is why the calculator prints the perimeter beside the base run rather than only `
       + `the answer: ${BASEBOARD.perimeter} lf and ${BASEBOARD.run} lf price different trades, `
       + 'and a sheet with one number on it will eventually be used for the wrong one.' },

    { h2: 'Getting the perimeter honestly' },
    { p: 'A perimeter four inches out over four walls moves the base run by a third of a stick, '
       + 'which nobody notices until the last wall. ScanToBid measures the room and then says, on '
       + 'every document, whether a tape has been on the walls the number came from — which is '
       + 'the only part of this that a calculator cannot do for you.' },
  ],
  faq: [
    { q: 'Do you subtract windows from a baseboard measurement?',
      a: 'No. Baseboard runs underneath a window, so the window changes nothing about the run. '
       + 'Doors and cased openings do interrupt it and both come off. Subtracting windows is '
       + 'the commonest way a trim order comes up short.' },
    { q: 'How do I work out linear feet of baseboard for a room?',
      a: 'Add up the walls to get the perimeter, then take off the width of every door and '
       + 'every cased opening. That is the run. Sticks come after, from the run and whatever '
       + 'stock length you are buying, rounded up.' },
    { q: 'Does the stick count allow for mitres and joins?',
      a: 'It cannot. It is the run divided by the stock length and rounded up. How many pieces '
       + 'a room really takes depends on where the joins land and what each mitre eats, and '
       + 'those are decisions made at the wall rather than facts about the room.' },
    { q: 'Is crown moulding the same measurement?',
      a: 'No — crown follows the ceiling line, so it runs straight over the door openings that '
       + 'the baseboard stops at. Crown is the perimeter; base is the perimeter less the doors. '
       + 'This calculator prints both.' },
  ],
  form: [
    ...ROOM_FIELDS,
    { select: 'stock', label: 'Stock length (optional)',
      options: [
        { value: '', label: 'Do not count sticks' },
        { value: "8'", label: '8 ft' },
        { value: "10'", label: '10 ft' },
        { value: "12'", label: '12 ft' },
        { value: "14'", label: '14 ft' },
        { value: "16'", label: '16 ft' },
      ] },
    { text: 'waste', label: 'Waste (optional)', hint: 'Your own figure, as a percentage.' },
  ],
  related: {
    calculators: ['drywall-sheets', 'paint', 'odd-shaped-room'],
    guides: ['measure-baseboard-trim', 'drywall-takeoff', 'square-footage-vs-wall-area'],
  },
},

{
  slug: 'odd-shaped-room',
  calc: 'room',
  title: 'Square footage of a room that is not a rectangle',
  metaTitle: 'Odd-Shaped Room Square Footage Calculator',
  description:
    'Walk the walls, in order, and get the area the walk actually encloses — for an '
    + 'L, a U, a bay or a chamfer. It also tells you when your room does not close.',
  keywords: ['odd shaped room square footage', 'l shaped room area calculator',
             'irregular room square footage', 'how to measure an l shaped room',
             'room area from wall lengths'],
  minutes: 8,
  standfirst:
    'Every generic calculator asks for a width and a depth, which is another way of '
    + 'saying it has already decided your room is a box. Most rooms worth measuring are not.',
  blocks: [
    { h2: 'Why width × depth is wrong on a real room' },
    { p: `Take an L: ${ODD_ROOM.walk[0].said} across the front, and a ${ODD_ROOM.bite} square `
       + 'bitten out of the back corner. Ask for a width and a depth and the only answer '
       + `available is ${ODD_ROOM.boxArea} sq ft. The walk encloses ${ODD_ROOM.floorArea} sq ft.` },
    { p: `${ODD_ROOM.overstated} square feet out, on one room, in the expensive direction. And `
       + `the perimeter is identical either way — ${ODD_ROOM.perimeter} lf both times — so `
       + 'nothing about the wrong answer looks wrong.' },
    { p: 'What a room actually is, to anybody measuring it, is a walk: a run, a turn, a run, a '
       + 'turn, all the way back to where you started. The area is whatever polygon that walk '
       + 'closes, and there is a formula for it that has been right since surveyors were the '
       + 'people who needed it.' },
    { formula: 'area = ½ |Σ (x<sub>i</sub> · y<sub>i+1</sub> − x<sub>i+1</sub> · y<sub>i</sub>)|',
      note: 'The shoelace formula, over the corners the walk lands on. It handles an L, a U, a '
          + 'bay and a chamfer without knowing which of them it has.' },

    { form: true },

    { h2: 'How to walk a room so the numbers come out' },
    { steps: [
        { h3: 'Start in a corner and pick a direction',
          p: 'Any corner. Any direction. What matters is that you keep going the same way '
           + 'round — all the way clockwise or all the way anticlockwise, never both.' },
        { h3: 'Write down every straight run',
          p: 'Corner to corner. A wall that changes direction is two runs, and a wall with a '
           + 'chamfer on the end is a run and a diagonal.' },
        { h3: 'Say which way each run goes',
          p: 'North, east, south, west, as you walk them. It does not matter whether north is '
           + 'really north — it only has to be consistent for the whole room.' },
        { h3: 'Finish where you started',
          p: 'The last run has to bring you back to the first corner. If it does not, one of '
           + 'the runs is wrong, and that is worth knowing before it is worth pricing.' },
      ] },
    { p: `The example above, written out: `
       + ODD_ROOM.walk.map((step) => `${step.said} ${step.heading}`).join(', ') + '.' },

    { h2: 'The check nothing else does: does the room close?' },
    { p: 'A room that does not close is a room where at least one measurement is wrong. Walk '
       + 'the runs, and if you do not finish where you started, the gap is the error — and it '
       + 'is a real number, in inches, that you can go and look for.' },
    { p: 'Every other calculator will happily give an area for a set of measurements that '
       + 'cannot be a room. This one says how far out the walk finished, on which axis, and '
       + 'refuses to print an area until it closes. An area worked out from a walk that does '
       + 'not close is the area of a shape that is not the room you are standing in.' },
    { note: 'It is also the fastest way to find a transposed figure. A run written down as 12 ft '
          + 'when the tape said 21 leaves nine feet of gap, on one axis, and nothing else in a '
          + 'takeoff would have caught it.' },

    { h2: 'What the walk gives you after the area' },
    { p: `The same walk produces every quantity the room can produce. On the L, at a `
       + `${ODD_ROOM.ceilingHeight} ceiling: `
       + `${ODD_ROOM.floorArea} sq ft of floor, ${ODD_ROOM.perimeter} lf of perimeter, `
       + `${ODD_ROOM.wallFace} sq ft of wall face, ${ODD_ROOM.baseboard} lf of base — before any `
       + 'opening is taken out, which the form above will do if you tell it about them.' },
    { p: 'That is the same order the app works in, because it is the same code. ScanToBid walks '
       + 'the room off the scan, lets you correct any run by hand, and then every quantity — '
       + 'floor, ceiling, wall face, base — falls out of the corrected walk rather than being '
       + 'measured again.' },
    { shot: 'plan', caption:
      'The walk as a drawing: real dimension lines, the openings in place, and a line under it '
      + 'saying whether anybody has put a tape on the walls the figures came from.' },
  ],
  faq: [
    { q: 'How do you calculate the square footage of an L-shaped room?',
      a: 'Walk it. Write down every straight run in order with the direction you walked it, '
       + 'finish where you started, and the area is the polygon that walk closes. Splitting the '
       + 'L into two rectangles gets the same answer when it is genuinely two rectangles, and '
       + 'stops working the moment there is an angle in the room.' },
    { q: 'What if my room has an angled wall?',
      a: 'A diagonal run is still a run. The walk handles it — the area of the polygon does not '
       + 'care whether an edge is square — which is exactly the case that defeats splitting a '
       + 'room into rectangles.' },
    { q: 'My measurements do not add up. What does that mean?',
      a: 'It means one of them is wrong, and the size of the gap tells you how wrong. The '
       + 'calculator says how far the walk finished from where it started, on each axis, '
       + 'instead of printing an area for a shape that cannot exist.' },
    { q: 'Does the direction I walk the room matter?',
      a: 'Only that it is consistent. Clockwise or anticlockwise both work; changing your mind '
       + 'halfway round does not. Which way is "north" does not matter either — it only has to '
       + 'mean the same thing for the whole room.' },
  ],
  form: [
    { shape: true, start: 'walk', walk: ODD_ROOM.walk,
      width: EXAMPLE_SAID.width, depth: EXAMPLE_SAID.depth },
    { text: 'height', label: 'Ceiling height', hint: 'For the wall face and the base run.',
      prefill: ODD_ROOM.ceilingHeight },
    { openings: true },
  ],
  related: {
    calculators: ['drywall-sheets', 'paint', 'baseboard-trim'],
    guides: ['square-footage-vs-wall-area', 'measure-a-room-for-flooring', 'drywall-takeoff'],
  },
},

];
