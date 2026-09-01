/**
 * Guides for the people who buy this: remodelers and general contractors.
 *
 * Every one answers a question somebody types into Google before they have ever
 * heard of Trueline, and answers it well enough to be worth reading on its own
 * — which is the only kind of page that ranks and stays ranked. The product is
 * mentioned where it is genuinely the answer and nowhere else.
 *
 * Nothing here quotes a price for materials or labour. Prices are local, they
 * move, and a number invented in a file is exactly the thing this whole product
 * exists to argue against. What these teach is the METHOD.
 */
export const CONTRACTOR = [

{
  slug: 'drywall-takeoff',
  audience: 'contractor',
  title: 'How to do a drywall takeoff, wall by wall',
  metaTitle: 'How to Do a Drywall Takeoff (Step by Step)',
  description:
    'Work out board, mud, tape and screws from the room itself — the arithmetic, '
    + 'the deductions that matter, and the two mistakes that cost the most.',
  keywords: ['drywall takeoff', 'how to estimate drywall', 'drywall quantity calculation',
             'sheetrock takeoff', 'drywall square footage'],
  minutes: 11,
  standfirst:
    'A drywall takeoff is four numbers and one decision. The four numbers come off '
    + 'the room. The decision is what you deduct — and it is where most sheets go '
    + 'missing.',
  blocks: [
    { h2: 'Start from wall area, not floor area' },
    { p: 'The single most expensive habit in estimating is pricing board off floor square '
       + 'footage. A 12 × 14 room has 168 sq ft of floor and, at an 8 ft ceiling, 416 sq ft '
       + 'of wall face before a single deduction. Quote the floor number and you are short '
       + 'by two and a half times the board.' },
    { p: 'Wall face is the perimeter times the ceiling height. Nothing else. Get the '
       + 'perimeter right and the rest is multiplication:' },
    { formula: 'wall face = perimeter × ceiling height', note:
      '12 + 14 + 12 + 14 = 52 ft of perimeter. 52 × 8 = 416 sq ft.' },
    { p: 'Ceilings are their own line and follow the floor outline exactly — 168 sq ft in '
       + 'the same room. Keep them separate: they are boarded differently, they are '
       + 'finished differently, and on many jobs somebody else does them.' },

    { h2: 'The deductions that are worth taking' },
    { p: 'Every opening is a hole in the wall face, and every one of them is board you do '
       + 'not buy. The argument is only ever about how small an opening is worth deducting.' },
    { table: {
        head: ['Opening', 'Typical face area', 'Deduct?'],
        rows: [
          ['Standard door, 3 ft × 6 ft 8 in', '20 sq ft', 'Always'],
          ['Cased opening, 5 ft wide', '33 sq ft or more', 'Always'],
          ['Window, 3 ft × 5 ft', '15 sq ft', 'Always'],
          ['Small window, 2 ft × 2 ft', '4 sq ft', 'Judgement — it is a third of a sheet'],
          ['Electrical box', 'a few square inches', 'Never'],
        ] } },
    { p: 'The rule most estimators land on is: deduct anything you would cut around rather '
       + 'than cut out of a sheet. A door changes how many sheets come off the truck. A '
       + 'switch box does not.' },
    { note: 'Deducting an opening from wall face and then forgetting to ADD the return — '
          + 'the strip of board wrapping into the jamb — is how a takeoff comes out short '
          + 'on a job with a lot of openings. A 3 ft × 6 ft 8 in door in a 4½ in wall has '
          + 'about 5 sq ft of return.' },

    { h2: 'Baseboard, and why it is not just the perimeter' },
    { p: 'Base runs the perimeter less the door openings and less any cased opening, and it '
       + 'runs straight under a window. Subtracting windows from base is the second '
       + 'commonest arithmetic error in a takeoff, and it always goes the same way: short.' },
    { formula: 'baseboard = perimeter − door widths − cased opening widths',
      note: 'Windows do not come off. The base runs under them.' },

    { h2: 'Turning area into sheets, mud and tape' },
    { p: 'Board comes in fixed sheets, so a takeoff in square feet has to become a count. '
       + 'The arithmetic is the same whichever size you hang:' },
    { table: {
        head: ['Sheet', 'Covers', 'Sheets for 416 sq ft'],
        rows: [
          ['4 × 8', '32 sq ft', '13'],
          ['4 × 12', '48 sq ft', '8.7 → 9'],
          ['4 × 16', '64 sq ft', '6.5 → 7'],
        ] } },
    { p: 'Always round up, then add waste on top. Waste is a decision about the room rather '
       + 'than a constant: a plain rectangle wastes very little, a room with three closets, '
       + 'a bulkhead and a bay window wastes a great deal. Whatever figure you use, use the '
       + 'same one every time so that when a job runs short you learn something from it.' },
    { p: 'Tape follows the joints, and joints follow the sheet layout, which is why tape is '
       + 'the one line that genuinely depends on how you hang it. Mud follows the board area '
       + 'and the finish level.' },

    { h2: 'Where the numbers should come from' },
    { p: 'Everything above rests on the perimeter and the ceiling height being right. A '
       + 'perimeter that is four inches out over four walls moves the wall face by more than '
       + 'ten square feet, and nobody notices, because the number looks exactly as '
       + 'authoritative as a correct one.' },
    { p: 'This is the reason Trueline refuses to call a scanned length a measurement. The '
       + 'phone gives you the shape of the room in seconds; a tape on one wall running each '
       + 'way is what turns that shape into numbers you can defend. Until that has happened, '
       + 'every sheet the app prints says <strong>SCANNED</strong> across it, where the '
       + 'client will read it.' },
    { shot: 'takeoff', caption:
      'A real takeoff off a real scan. Every line shows its own workings, and the sheet '
      + 'says the numbers came off a scanner rather than a tape.' },
  ],
  faq: [
    { q: 'Do you deduct doors and windows from a drywall takeoff?',
      a: 'Yes — every door, window and cased opening comes off the wall face, because each '
       + 'one is board you do not buy. What you must not forget is to add the return: the '
       + 'strip of board that wraps into the jamb. A standard door in a 4½ inch wall carries '
       + 'roughly 5 sq ft of return.' },
    { q: 'Is drywall estimated by square foot or by sheet?',
      a: 'Both, in that order. You work the area out in square feet from the perimeter and '
       + 'the ceiling height, then divide by the sheet size you are hanging and round up. '
       + 'Pricing per square foot and ordering per sheet is normal.' },
    { q: 'How much waste should I add to a drywall takeoff?',
      a: 'It depends entirely on the room — a plain rectangle wastes almost nothing and a '
       + 'room full of closets and bulkheads wastes a lot. The useful discipline is to pick a '
       + 'figure, use it on every job, and adjust it when a job runs short. A constant you '
       + 'never revisit teaches you nothing.' },
    { q: 'Does the ceiling go in the same line as the walls?',
      a: 'Keep them separate. Ceiling area follows the floor outline and wall face follows '
       + 'the perimeter times the height; they are boarded, finished and often subcontracted '
       + 'differently, so a takeoff that adds them together cannot be priced properly.' },
  ],
  related: ['measure-baseboard-trim', 'square-footage-vs-wall-area', 'construction-estimate-template'],
  download: 'takeoff-sheet',
},

{
  slug: 'construction-estimate-template',
  audience: 'contractor',
  title: 'What a construction estimate has to include',
  metaTitle: 'Construction Estimate Template: What to Include',
  description:
    'The eleven things an estimate needs before you hand it over, why each one '
    + 'exists, and a blank template to print. Written to stop disputes, not to win them.',
  keywords: ['construction estimate template', 'contractor estimate template',
             'what should an estimate include', 'free estimate form contractor'],
  minutes: 10,
  standfirst:
    'Most estimate disputes are not about the price. They are about something the '
    + 'estimate did not say — and every one of those omissions is on this list.',
  blocks: [
    { h2: 'The eleven things' },
    { p: 'An estimate is a document somebody will read again in three months, angry. Write '
       + 'it for that reading rather than for the one where they are pleased with you.' },
    { steps: [
        { h3: 'Who you are', p: 'Business name, address, phone, licence number and insurance. '
          + 'A licence number on an estimate is not decoration — in most states a homeowner '
          + 'can check it in thirty seconds, and the ones who do are the ones who pay on time.' },
        { h3: 'Who it is for, and where the work is',
          p: 'The client’s name and the address of the work, which are frequently not the '
           + 'same address. Every later document — change orders, invoices, lien notices — '
           + 'hangs off this line.' },
        { h3: 'A date, and how long the price holds',
          p: 'Material prices move. An estimate with no expiry is an open offer, and you will '
           + 'be held to it. Thirty days is common; whatever you choose, print it.' },
        { h3: 'The scope, in sentences',
          p: 'What is being done, in the order it will be done, in language a homeowner reads '
           + 'without a glossary. This is the section that decides arguments.' },
        { h3: 'The quantities',
          p: 'How much of each thing. Not because a client checks them, but because a client '
           + 'who can see 416 sq ft of wall face understands where the number came from — and '
           + 'because you will need them when the scope changes.' },
        { h3: 'The price, broken out enough to be defensible',
          p: 'Line by line, or by trade, or by phase. One number with nothing behind it reads '
           + 'as a guess even when it is not.' },
        { h3: 'What is NOT included',
          p: 'The most valuable paragraph in the document. Permits, disposal, painting, '
           + 'anything behind a wall nobody has opened. Every exclusion you write is an '
           + 'argument you have already won.' },
        { h3: 'Allowances, if any',
          p: 'Where the client picks the material later, say what you have allowed and what '
           + 'happens when they pick something dearer. An allowance with no number in it is '
           + 'a change order waiting to happen.' },
        { h3: 'Payment terms',
          p: 'Deposit, progress payments and what triggers each one. "On completion" is not a '
           + 'trigger; "on completion of rough-in" is.' },
        { h3: 'How change orders work',
          p: 'One sentence: work outside this scope is quoted and signed before it starts. '
           + 'Then hold to it, every time, including the small ones.' },
        { h3: 'Somewhere to sign',
          p: 'An estimate nobody signed is a conversation. A signed one is a scope, and the '
           + 'difference shows up the first time somebody says "I thought that was included."' },
      ] },

    { h2: 'Estimate, quote, bid, proposal' },
    { p: 'These words are used loosely and it matters which one you have handed over.' },
    { table: {
        head: ['What it is', 'What it means to a client', 'Risk to you'],
        rows: [
          ['Estimate', 'A considered guess that may move', 'Low — if it says so on the paper'],
          ['Quote', 'A price you will honour', 'High — you own the overrun'],
          ['Bid', 'A price offered in competition', 'High, and usually under pressure'],
          ['Proposal', 'Scope and price, offered for signature', 'Depends entirely on the scope section'],
        ] } },
    { p: 'Whichever you write, the word at the top should match the terms underneath it. An '
       + '"estimate" with a fixed price and a signature line is a quote wearing a hat.' },

    { h2: 'Where the quantities come from' },
    { p: 'Everything above assumes you have quantities to print. On a remodel that means '
       + 'measuring the room, and the honest problem with measuring is that the numbers you '
       + 'took standing up in a half-demolished kitchen become numbers on a legal document '
       + 'later, with nothing on the page saying which is which.' },
    { p: 'That is the specific thing Trueline was built to fix: a length carries how it was '
       + 'arrived at — scanned, drawn, or measured with a tape — right through onto the '
       + 'estimate, so the document tells the client what it is standing on.' },
    { shot: 'proposal', caption:
      'Scope, price, exclusions and a signature line, generated from the same measurements '
      + 'as the takeoff so the two cannot disagree.' },
  ],
  faq: [
    { q: 'Is a contractor’s estimate legally binding?',
      a: 'It depends on what the document says and on your state. A document headed '
       + '"estimate" that states the price may change is generally treated differently from '
       + 'a fixed quote that has been signed. The safest position is that the words on the '
       + 'page decide it, so write them deliberately rather than reaching for a template.' },
    { q: 'How detailed should a construction estimate be?',
      a: 'Detailed enough that a client can see where the number came from and detailed '
       + 'enough that you can tell, later, whether something was in scope. In practice that '
       + 'means quantities and a real exclusions list, not a per-square-foot number with '
       + 'nothing behind it.' },
    { q: 'Should I charge for an estimate?',
      a: 'A walk-through and a rough number is usually free. A measured takeoff on a large '
       + 'remodel is a day of work, and plenty of contractors charge for it and credit it '
       + 'against the job if they win it. What matters is saying which one you are offering '
       + 'before you start.' },
    { q: 'What should never go in an estimate?',
      a: 'A quantity nobody measured, presented as though somebody had. That is the failure '
       + 'that turns into a dispute you cannot win, because you cannot show where the number '
       + 'came from.' },
  ],
  related: ['remodeling-proposal', 'change-order', 'estimate-red-flags'],
  download: 'estimate-form',
},

{
  slug: 'measure-a-room-for-flooring',
  audience: 'contractor',
  title: 'How to measure a room for flooring',
  metaTitle: 'How to Measure a Room for Flooring Properly',
  description:
    'Floor area, waste, direction of lay, and the closets and thresholds people '
    + 'forget. Includes how to handle an L-shape without guessing.',
  keywords: ['how to measure a room for flooring', 'flooring square footage',
             'measure floor area', 'flooring waste factor'],
  minutes: 9,
  standfirst:
    'Flooring is the one takeoff where the shape of the room matters as much as its '
    + 'size, and where the offcuts decide whether you made money.',
  blocks: [
    { h2: 'Measure the outline, not the rectangle' },
    { p: 'Almost no room is a rectangle. There is a chimney breast, a closet, a bump-out for '
       + 'the plumbing stack. The right way to handle it is to break the outline into '
       + 'rectangles, work each one out, and add them — never to take the longest dimension '
       + 'each way and multiply.' },
    { formula: 'L-shaped room = (A × B) + (C × D)',
      note: 'Split at the inside corner. Two rectangles, added. Never length × width of the '
          + 'bounding box, which is the commonest over-order in flooring.' },
    { p: 'Closets, alcoves and the strip inside a doorway are floor. They get flooring, they '
       + 'get underlay, and they are missed constantly because they are not part of the room '
       + 'you are standing in.' },

    { h2: 'Waste is about direction, not just percentage' },
    { p: 'Waste on a floor comes from the offcut at the end of each run. That means it '
       + 'depends on the room’s dimension in the direction of lay, the plank length, and '
       + 'whether you can start the next row with the last offcut.' },
    { table: {
        head: ['Situation', 'Why it wastes'],
        rows: [
          ['Room width is just over a plank multiple', 'Every row ends in a short, unusable offcut'],
          ['Diagonal or herringbone lay', 'Every board meets a wall at an angle'],
          ['Lots of doorways and closets', 'Many short runs, each with its own offcut'],
          ['Long straight room, plank lay', 'Offcuts start the next row — very little waste'],
        ] } },
    { p: 'A single blanket percentage across every job is a way of being wrong twice: over '
       + 'on the simple rooms, short on the complicated ones. Look at the shape before you '
       + 'pick the figure.' },

    { h2: 'Thresholds, transitions and the things that are not floor' },
    { p: 'Where the floor meets something else, somebody has to buy a transition strip, and '
       + 'it is linear feet rather than square feet. Count doorways, not rooms.' },
    { p: 'Underlay follows floor area exactly and comes in rolls of a fixed coverage, which '
       + 'is a different rounding from the flooring itself.' },

    { h2: 'Getting the outline right in the first place' },
    { p: 'All of this rests on the outline. A phone with LiDAR gives you that outline in the '
       + 'time it takes to walk the room, including the closet you would have forgotten — and '
       + 'the area comes off the outline rather than off two numbers multiplied together.' },
    { p: 'What it does not give you is a measurement. A tape on one wall running each way is '
       + 'what turns a scanned outline into a number worth ordering material against, and '
       + 'Trueline says which one it is holding at every point until you do.' },
    { shot: 'plan', caption:
      'The outline as the phone found it, dimensioned, with the notch for the doorway. '
      + 'The line under it says these are the scanner’s numbers.' },
  ],
  faq: [
    { q: 'How do you measure an L-shaped room for flooring?',
      a: 'Split it into rectangles at the inside corner, work out each rectangle, and add '
       + 'them. Do not take the longest dimension each way and multiply — that measures the '
       + 'bounding box, which includes floor that is not there.' },
    { q: 'Do you include closets in flooring square footage?',
      a: 'If they are getting floor, yes — and they usually are. Closets, alcoves and the '
       + 'strip inside a doorway are all floor area and all commonly missed.' },
    { q: 'How much waste do you add for flooring?',
      a: 'It depends on the lay and the shape rather than on a single number. A long straight '
       + 'plank run in a simple room wastes very little because offcuts start the next row; a '
       + 'diagonal lay in a room full of doorways wastes a great deal. Decide it per room.' },
  ],
  related: ['square-footage-vs-wall-area', 'drywall-takeoff', 'lidar-room-scanning'],
  download: null,
},

{
  slug: 'square-footage-vs-wall-area',
  audience: 'contractor',
  title: 'Square footage vs wall area: the mistake that costs the most',
  metaTitle: 'Square Footage vs Wall Area in Estimating',
  description:
    'Floor area, wall face, ceiling area and perimeter are four different numbers. '
    + 'Which one each trade prices off, and what happens when you mix them up.',
  keywords: ['square footage vs wall area', 'wall square footage calculation',
             'floor area vs wall area', 'how to calculate wall area'],
  minutes: 7,
  standfirst:
    'One room has four areas in it. Quote off the wrong one and you are not slightly '
    + 'out — you are out by a multiple.',
  blocks: [
    { h2: 'The four numbers, in one room' },
    { p: 'Take a plain 12 ft × 14 ft room with an 8 ft ceiling. Here is every area in it:' },
    { table: {
        head: ['Number', 'How it is worked out', 'This room', 'Who prices off it'],
        rows: [
          ['Floor area', 'the floor outline', '168 sq ft', 'Flooring, tile, underlay'],
          ['Ceiling area', 'follows the floor outline', '168 sq ft', 'Ceiling board, paint'],
          ['Wall face', 'perimeter × ceiling height', '416 sq ft', 'Drywall, paint, primer'],
          ['Perimeter', 'the walls added end to end', '52 ft', 'Base, shoe, crown, plates'],
        ] } },
    { p: 'Wall face is <strong>two and a half times</strong> the floor area in this room, and '
       + 'the taller the ceiling the wider that gap gets. At 10 ft it is 520 sq ft — over '
       + 'three times.' },

    { h2: 'How the mix-up actually happens' },
    { p: 'Nobody sits down and decides to price drywall off floor area. It happens because '
       + '"square feet" is used for both, and because the number that is easiest to get — the '
       + 'one on the listing, the one the homeowner says — is always the floor.' },
    { ul: [
        'A homeowner says "it is a 200 square foot room". That is floor.',
        'A price list says "$1.85 per square foot installed". That is usually wall face for board, and floor for flooring — and the list rarely says which.',
        'A takeoff app gives one figure called "area". If it does not say which area, it is not usable.',
      ] },
    { note: 'The tell is the ceiling height. If a number does not change when the ceiling '
          + 'height changes, it is not wall face. If you cannot find the ceiling height on a '
          + 'quote for drywall, the quote is standing on nothing.' },

    { h2: 'Perimeter is its own trap' },
    { p: 'Base and crown run the perimeter, but not the whole perimeter — doors and cased '
       + 'openings come out of it, and windows do not. Plates run the perimeter twice, or '
       + 'three times with a double top plate, which is why plate stock and base are never '
       + 'the same figure even though both are "linear feet of wall".' },

    { h2: 'Keeping them apart' },
    { p: 'The discipline is simple and unglamorous: never write "area" on anything. Write '
       + 'floor, ceiling, wall face or perimeter, and put the unit beside it. A line that '
       + 'says <code>Wall face — 416 sq ft</code> cannot be misread. A line that says '
       + '<code>Area — 416</code> will be, eventually, by you.' },
    { p: 'Trueline never prints a bare area for this reason. Every line on a takeoff names '
       + 'which of the four it is, carries its unit, and shows the arithmetic that produced '
       + 'it, so a number can be checked rather than trusted.' },
    { h2: 'Working it out on a room that is not a rectangle' },
    { p: 'Almost no real room is a plain box, and the four numbers each handle that '
       + 'differently — which is where a takeoff quietly goes wrong on an L-shaped room.' },
    { table: {
        head: ['Number', 'On an L-shape'],
        rows: [
          ['Floor area', 'Split at the inside corner into two rectangles and add them. Never the bounding box.'],
          ['Ceiling area', 'The same split, unless there is a bulkhead or a soffit — then it is its own outline.'],
          ['Wall face', 'Perimeter still works, and the perimeter of an L is longer than it looks: six walls, not four.'],
          ['Perimeter', 'Walk it wall by wall. Pacing the outside of the room misses the return.'],
        ] } },
    { p: 'The L-shape trap is specifically the bounding box. A 20 × 16 bounding box with a '
       + '6 × 5 notch taken out of it is 320 − 30 = 290 sq ft of floor, and the number people '
       + 'reach for is 320. That is thirty square feet of flooring nobody is laying.' },

    { h2: 'Ceilings that are not flat' },
    { p: 'The moment there is a vault, a tray, a soffit or a bulkhead, ceiling area stops '
       + 'following the floor and has to be worked out on its own. A vaulted ceiling is larger '
       + 'than the floor beneath it, sometimes considerably, and a soffit takes area off the '
       + 'ceiling and adds it to the wall face — plus its own returns.' },
    { p: 'This is worth flagging on the estimate itself, because it is the commonest place a '
       + 'ceiling quote and a ceiling invoice disagree.' },

    { h2: 'A quick way to sanity-check any of them' },
    { ul: [
        'Wall face should be roughly 2 to 3 times the floor area in a normal room. Much less and somebody has used the floor figure.',
        'Ceiling should equal floor, exactly, unless somebody has said why not.',
        'Perimeter in feet should be roughly 4 × √(floor area) for a squarish room. A perimeter far above that means a complicated shape — or an error.',
        'Baseboard should be a bit less than perimeter. If it is more, windows have been added by mistake.',
      ] },
    { p: 'None of these proves a number right. All of them catch the kind of wrong that costs '
       + 'the most, which is a factor rather than a few inches.' },
  ],
  faq: [
    { q: 'Is wall area the same as square footage?',
      a: 'No. "Square footage" almost always means floor area. Wall area — wall face — is the '
       + 'perimeter multiplied by the ceiling height, and in an ordinary room it is roughly '
       + 'two and a half times the floor figure.' },
    { q: 'How do you calculate wall square footage?',
      a: 'Add the walls end to end to get the perimeter, multiply by the ceiling height, then '
       + 'deduct the face area of every door, window and cased opening. Add back the returns '
       + 'that wrap into each jamb if you are boarding them.' },
    { q: 'Does ceiling area equal floor area?',
      a: 'In a flat-ceilinged room, yes — it follows the same outline. It stops being true '
       + 'the moment there is a vaulted ceiling, a soffit or a bulkhead, and at that point '
       + 'the two must be worked out separately.' },
    { q: 'How do you calculate wall area for an L-shaped room?',
      a: 'The perimeter still works — walk it wall by wall and multiply by the ceiling height. '
       + 'The mistake is on floor area, where people take the bounding box: split the outline '
       + 'at the inside corner into two rectangles and add those instead.' },
    { q: 'Does a vaulted ceiling change the ceiling area?',
      a: 'Yes, and usually upwards. Once a ceiling is not flat it stops following the floor '
       + 'outline and has to be worked out on its own — which is also the commonest place a '
       + 'ceiling quote and a ceiling invoice end up disagreeing.' },
  ],
  related: ['drywall-takeoff', 'measure-baseboard-trim', 'measure-a-room-for-flooring'],
  download: null,
},

{
  slug: 'measure-baseboard-trim',
  audience: 'contractor',
  title: 'How to measure baseboard and trim without coming up short',
  metaTitle: 'How to Measure Baseboard and Trim Accurately',
  description:
    'What comes off the perimeter, what does not, how to count casing and how to '
    + 'buy stock in lengths without paying for offcuts twice.',
  keywords: ['how to measure baseboard', 'baseboard linear feet', 'trim takeoff',
             'how much baseboard do I need', 'casing calculation'],
  minutes: 8,
  standfirst:
    'Base is the easiest takeoff in the house to get roughly right and one of the '
    + 'easiest to get exactly wrong, because of one subtraction that should not happen.',
  blocks: [
    { h2: 'The rule, in one line' },
    { formula: 'baseboard = perimeter − door openings − cased openings',
      note: 'Windows stay in. The base runs underneath them.' },
    { p: 'That is the whole of it, and the window is where people go wrong. A window is a '
       + 'hole in the wall face and it is not a hole in the base run, because there is wall '
       + 'below it. Subtract windows and every room in the house comes up short.' },

    { h2: 'What else eats the run' },
    { ul: [
        'A hearth or a fireplace surround, if the base dies into it.',
        'Full-height cabinets and built-ins — base stops at them.',
        'A staircase, where the base becomes skirting and is a different item.',
        'Open closets, which usually ADD run rather than remove it.',
      ] },
    { p: 'Closets are the reliable surprise. A pair of reach-in closets can add fifteen or '
       + 'twenty feet of base to a bedroom, and they are not part of the room you paced out.' },

    { h2: 'Casing is a count, not a length' },
    { p: 'Casing goes round openings, so it is worked out per opening and then added up. A '
       + 'standard door cased both sides takes roughly twice its perimeter less the sill:' },
    { table: {
        head: ['Opening', 'Casing per side', 'Both sides'],
        rows: [
          ['3 ft × 6 ft 8 in door', '≈ 17 ft', '≈ 34 ft'],
          ['Window, 3 ft × 5 ft, cased four sides', '≈ 16 ft', 'usually one side only'],
          ['5 ft cased opening', '≈ 21 ft', '≈ 42 ft'],
        ] } },
    { p: 'Count the openings first, decide which are cased on one side or both, then multiply. '
       + 'Trying to hold that in your head while walking the house is how a door gets missed.' },

    { h2: 'Buying it in lengths' },
    { p: 'Trim comes in fixed lengths and you cannot join it invisibly on a short wall, so '
       + 'the useful number is not total linear feet — it is the list of individual wall runs. '
       + 'Nine feet of base on an eleven-foot wall is one sixteen-foot stick, not nine feet '
       + 'of stock.' },
    { p: 'A takeoff that gives you a single total is fine for pricing and useless for '
       + 'ordering. Keep the wall-by-wall list.' },

    { h2: 'Where the perimeter comes from' },
    { p: 'Base is perimeter arithmetic, so it is only ever as good as the perimeter. That is '
       + 'the number a phone scan gives you quickly and a tape gives you properly — and '
       + 'Trueline keeps the two apart, wall by wall, so a base figure standing on a scan '
       + 'says so.' },
    { h2: 'Working round a staircase' },
    { p: 'Where base meets a stair it usually becomes skirting, cut on the rake, and that is a '
       + 'different item at a different labour rate. Measure it separately and price it '
       + 'separately — a run of raked skirting priced as straight base is one of the reliable '
       + 'ways to lose money on a hallway.' },
    { p: 'The same is true of returns at the bottom of a stringer, and of any base that dies '
       + 'into a newel post. They are counted, not measured.' },

    { h2: 'Crown, and why it is not base upside down' },
    { p: 'Crown runs the perimeter at the ceiling, so it does not lose the doors — a door does '
       + 'not reach the ceiling. It runs the full perimeter, and it gains anything base loses '
       + 'to a cabinet, because the uppers stop below the crown line unless somebody has run it '
       + 'to the cabinet tops.' },
    { formula: 'crown ≈ full perimeter (no door deduction)',
      note: 'Cased openings that go to the ceiling are the exception, and they are rare.' },
    { p: 'Mitres are where crown costs money. Inside and outside corners are counted, not '
       + 'measured, and an eight-corner room takes far longer than a four-corner room of the '
       + 'same perimeter.' },

    { h2: 'Waste, and the offcut you can use' },
    { p: 'Base offcuts are usable in a way flooring offcuts often are not: a short piece goes '
       + 'in a closet, behind a door swing, or on a short return. So the useful discipline is '
       + 'to list the runs longest first, buy for the long ones, and let the shorts come out '
       + 'of what is left.' },
    { p: 'That only works if you kept the wall-by-wall list. A single total in linear feet '
       + 'cannot tell you whether you need six sixteen-foot sticks or twelve eight-foot ones.' },
  ],
  faq: [
    { q: 'Do you subtract windows when measuring baseboard?',
      a: 'No. The base runs under a window because there is wall below it. Only doors and '
       + 'cased openings come out of the perimeter.' },
    { q: 'How do you calculate linear feet of baseboard?',
      a: 'Add the wall lengths to get the perimeter, subtract the width of every door and '
       + 'cased opening, and add any closet walls that are getting base. Keep the wall-by-wall '
       + 'list for ordering — the total alone will not tell you what lengths to buy.' },
    { q: 'How much casing does a door take?',
      a: 'Roughly the perimeter of the opening less the floor side, which is about 17 feet on '
       + 'a standard 3 ft × 6 ft 8 in door. Double it if the door is cased on both sides.' },
    { q: 'Do you deduct doors from crown moulding?',
      a: 'No. Crown runs at the ceiling and a door does not reach it, so crown takes the full '
       + 'perimeter. It is base that loses the doors, and base that stops at cabinets while '
       + 'crown carries on above them.' },
    { q: 'How do you price raked skirting on a staircase?',
      a: 'Separately, and at a higher labour rate than straight base. Every cut is an angle, '
       + 'the returns at the bottom are their own item, and pricing it as ordinary base is a '
       + 'common way to lose money on a hallway.' },
  ],
  related: ['drywall-takeoff', 'square-footage-vs-wall-area', 'construction-estimate-template'],
  download: 'takeoff-sheet',
},

{
  slug: 'lidar-room-scanning',
  audience: 'contractor',
  title: 'LiDAR room scanning: what it is good at, and where it fails',
  metaTitle: 'LiDAR Room Scanning for Contractors: Honest Guide',
  description:
    'What an iPhone’s LiDAR scanner actually measures, the five situations where it '
    + 'gets a room wrong, and why a scan is a shape rather than a measurement.',
  keywords: ['lidar room scanning', 'iphone lidar accuracy', 'roomplan',
             'lidar measuring app', 'how accurate is lidar scanning'],
  minutes: 12,
  standfirst:
    'A LiDAR scan gives you the shape of a room in about ninety seconds. What it does '
    + 'not give you is permission to stop measuring — and knowing exactly where it goes '
    + 'wrong is what makes it useful rather than dangerous.',
  blocks: [
    { h2: 'What the scanner is actually doing' },
    { p: 'The sensor on the back of a Pro iPhone throws out a grid of infrared dots and times '
       + 'how long each one takes to come back. That gives depth. The phone combines depth '
       + 'with the camera and with its own motion tracking, builds a mesh of the space, and '
       + 'then software decides which parts of that mesh are walls, floors, doors and windows.' },
    { p: 'That last step is the interesting one. The mesh is measurement; the walls are '
       + '<em>interpretation</em>. Apple’s RoomPlan framework does the interpreting on modern '
       + 'iPhones, and it is very good — which is precisely why it is easy to over-trust.' },

    { h2: 'The five places it goes wrong' },
    { steps: [
        { h3: 'Mirrors and glass', p: 'Infrared goes straight through glass and bounces off '
          + 'mirrors, so a mirrored closet door can appear as a room continuing beyond the '
          + 'wall, and a large window can appear as a hole in the world.' },
        { h3: 'Dark or shiny surfaces', p: 'Very dark matte paint and gloss both return less '
          + 'usable signal. A black feature wall is one of the most common causes of a wall '
          + 'that comes back short or wavy.' },
        { h3: 'Clutter against the wall', p: 'A wall you cannot see is a wall the phone '
          + 'infers. Furniture, stacked boxes and full shelving push the detected wall plane '
          + 'forward or leave a gap the software bridges with a straight line.' },
        { h3: 'Very large rooms and long walks', p: 'Motion tracking drifts. The further you '
          + 'walk without returning to something the phone has already seen, the more the '
          + 'far end of a long room can be out relative to the near end.' },
        { h3: 'Anything that is not a flat wall', p: 'Bay windows, curved walls, deep '
          + 'bulkheads and stepped ceilings are the cases where interpretation has the least '
          + 'to work with, and where a scan most often produces a clean, confident, wrong '
          + 'shape.' },
      ] },
    { note: 'The failure mode that matters is not "it produces an error message". It is that '
          + 'a wrong scan looks exactly as tidy and authoritative as a right one. Nothing on '
          + 'the screen distinguishes them — which is why the app has to.' },

    { h2: 'So what is it good for?' },
    { p: 'Shape. Openings. Not forgetting the closet. A scan gets you the outline of a room, '
       + 'the position of every door and window, and a set of quantities to argue with — in '
       + 'the time it takes to walk round with your arm out. Doing that with a tape and a pad '
       + 'takes twenty minutes and you will still miss the bulkhead.' },
    { p: 'The right way to use it is as a first pass that tells you what to measure. Walk it, '
       + 'look at the plan, and put a tape on the walls that matter — which on almost every '
       + 'room means one wall running each way, because that is what pins the whole outline.' },

    { h2: 'Why Trueline prints the word SCANNED on the drawing' },
    { p: 'Every length in this app carries how it was arrived at, and there are only three '
       + 'answers: scanned by the phone, drawn on a grid, or measured with a tape. That '
       + 'provenance follows the number onto the plan, the takeoff, the proposal and the '
       + 'claim document.' },
    { p: 'Until a tape has been on one wall running each way, the sheet says so across its '
       + 'face, where a client reads it. It is the opposite of what most measuring software '
       + 'does, and it is the entire reason the app exists: a number you cannot defend is '
       + 'worse than no number.' },
    { shot: 'inside', caption:
      'Standing inside a scanned room. Every wall carries its length and whether anybody has '
      + 'put a tape on it.' },
  ],
  faq: [
    { q: 'How accurate is iPhone LiDAR for measuring a room?',
      a: 'Nobody should quote you a single figure, because it depends on the room. Mirrors, '
       + 'glass, dark surfaces, clutter against walls and long walks all degrade it, and none '
       + 'of them announces itself. Treat a scan as a shape to check rather than a set of '
       + 'measurements to price off — and put a tape on one wall running each way before you '
       + 'quote.' },
    { q: 'Which iPhones have LiDAR?',
      a: 'The Pro and Pro Max models from the iPhone 12 Pro onwards, and the iPad Pro from '
       + '2020. Non-Pro iPhones do not have the sensor, which is why any serious measuring '
       + 'app also needs a way to work without it.' },
    { q: 'Can I scan a room without LiDAR?',
      a: 'Yes, in two ways. You can walk the room and tap each corner through the camera '
       + 'using plain ARKit tracking, or you can skip the camera entirely and tap the corners '
       + 'onto a grid — which is also the only way to do a room you cannot get back into.' },
    { q: 'Does a LiDAR scan replace a tape measure?',
      a: 'No, and any app that implies it does is selling you a risk. It replaces the sketch '
       + 'pad. The tape is what turns a scanned shape into numbers you can put on a contract.' },
  ],
  related: ['do-i-need-lidar-iphone', 'laser-measure-vs-phone-scan', 'drywall-takeoff'],
  download: null,
},

{
  slug: 'remodeling-proposal',
  audience: 'contractor',
  title: 'How to write a remodeling proposal a homeowner will sign',
  metaTitle: 'Write a Remodeling Proposal That Gets Signed',
  description:
    'Structure, language and the exclusions paragraph. Why options beat a single '
    + 'price, and what has to be on the page before you ask for a signature.',
  keywords: ['remodeling proposal', 'how to write a contractor proposal',
             'construction proposal template', 'contractor proposal example'],
  minutes: 10,
  standfirst:
    'An estimate answers "how much". A proposal answers "what am I agreeing to" — '
    + 'and that is the question a homeowner is actually stuck on.',
  blocks: [
    { h2: 'Write the scope before the price' },
    { p: 'The price is the part everybody drafts first and the part nobody argues about. '
       + 'Arguments are about scope, months later, when the words on the page are all anybody '
       + 'has. Write those words as though you will not be in the room to explain them.' },
    { p: 'Three sentences, in the order the work happens, in a homeowner’s vocabulary. Not '
       + '"demo, R&R GWB, finish L4" — "take the old floor and the base out, board and finish '
       + 'the walls, then lay the new floor and put the base back."' },

    { h2: 'Offer two options, not one price' },
    { p: 'A single number is a yes-or-no question, and a homeowner who is uncertain answers '
       + 'those with "let me think about it". Two options change the question from whether to '
       + 'hire you into which one to pick.' },
    { table: {
        head: ['Option', 'What it is', 'Why it works'],
        rows: [
          ['As measured', 'Exactly the scope you walked', 'The honest baseline'],
          ['With the extra', 'One meaningful addition — the closet, the lighting, the second coat',
           'Gives a yes somewhere to land that is not "no"'],
        ] } },
    { p: 'Two is the number. Three starts to look like a menu and pushes people back into '
       + 'deciding rather than choosing.' },

    { h2: 'The exclusions paragraph is the most valuable one' },
    { p: 'Everything you do not say is included is a conversation you will have later, from a '
       + 'weaker position. Write the list plainly:' },
    { ul: [
        'Permits and inspection fees, if they are not yours.',
        'Disposal and dumpster, if separate.',
        'Anything behind a wall nobody has opened yet.',
        'Painting, if the scope stops at finished board.',
        'Moving furniture, appliances and the contents of the room.',
        'Anything the quantities were scanned rather than measured — say it, and say when it will be measured.',
      ] },
    { note: 'The last one is unusual and it is worth doing. A proposal that says "these '
          + 'quantities came off a scan and will be confirmed with a tape before work starts" '
          + 'reads as careful rather than uncertain, and it protects you when a number moves.' },

    { h2: 'Signing it properly' },
    { p: 'An electronic signature is a signature. Under the federal ESIGN Act and the state '
       + 'UETAs, a record is not invalid merely because it is electronic, and no signing '
       + 'service is required — what decides a dispute is the quality of the record you kept.' },
    { p: 'A record worth having says who signed, when, on what device, the exact wording they '
       + 'agreed to, that they consented to sign electronically, and a hash of the document as '
       + 'it stood at that moment. Anything less is a picture of a name.' },
    { p: 'That is what Trueline records, and the signed scope then becomes the thing the job '
       + 'is measured against — never edited, with anything that changes becoming a change '
       + 'order that is itself signed before work starts.' },
    { shot: 'proposal', caption:
      'Option, price, exclusions and a signature line, built from the same measurements as '
      + 'the takeoff so the two cannot drift apart.' },
  ],
  faq: [
    { q: 'What is the difference between an estimate and a proposal?',
      a: 'An estimate is a price. A proposal is a scope offered for signature, with a price '
       + 'attached and an exclusions list. The proposal is the document that decides a '
       + 'dispute, because it says what was agreed rather than only what it cost.' },
    { q: 'Are electronic signatures legal for construction contracts?',
      a: 'In the United States, the ESIGN Act and state UETA laws mean a contract is not '
       + 'invalid simply because it was signed electronically, and no third-party service is '
       + 'required. What matters in a dispute is the record: who signed, when, what exact '
       + 'wording they agreed to, and proof the document has not changed since.' },
    { q: 'How many options should a proposal have?',
      a: 'Two. One is a yes-or-no question and gets "let me think about it"; three or more '
       + 'turns it into a menu and delays the decision.' },
    { q: 'Should a proposal show quantities?',
      a: 'Yes. A homeowner who can see 416 square feet of wall face understands where the '
       + 'number came from, and you will need those quantities the moment the scope changes.' },
  ],
  related: ['construction-estimate-template', 'change-order', 'read-a-contractor-quote'],
  download: 'proposal-form',
},

{
  slug: 'change-order',
  audience: 'contractor',
  title: 'How to write a change order that actually gets paid',
  metaTitle: 'How to Write a Change Order That Gets Paid',
  description:
    'What a change order must contain, why it has to be signed before the work '
    + 'starts, and how to handle the small ones without losing the client.',
  keywords: ['change order', 'construction change order form', 'how to write a change order',
             'change order template contractor'],
  minutes: 8,
  standfirst:
    'Almost every unpaid change order has the same fault: the work was already done '
    + 'when the paper appeared.',
  blocks: [
    { h2: 'The rule that decides whether you get paid' },
    { p: 'Signed before it starts. Not signed at the end of the week, not "I mentioned it on '
       + 'Tuesday", not a text message. Once work is done, the conversation is about whether '
       + 'the client owes you for something they already have — and that is an argument you '
       + 'lose more often than you win, regardless of who was right.' },
    { note: 'The hardest ones to hold this line on are the small ones, and the small ones are '
          + 'where the habit is set. A client who has signed for a $180 change is not '
          + 'surprised by the process on the $4,000 one.' },

    { h2: 'What has to be on it' },
    { steps: [
        { h3: 'Which contract it changes', p: 'The original agreement by date and address. A '
          + 'change order floating free of the thing it changes is just an invoice.' },
        { h3: 'What is different, in scope terms',
          p: 'What is being added, removed or substituted. If a quantity moves, say the old '
           + 'one and the new one — "wall face 416 sq ft → 468 sq ft" tells the whole story.' },
        { h3: 'Why', p: 'Client request, unforeseen condition, or design change. It costs one '
          + 'line and it is the line that stops the disagreement about whose fault it is.' },
        { h3: 'The price of the change, on its own',
          p: 'Not the new total. The delta, so it can be checked against the work.' },
        { h3: 'The effect on the schedule',
          p: 'Even if the answer is none — say none. Unstated schedule impact is the second '
           + 'commonest change-order dispute after price.' },
        { h3: 'A signature and a date', p: 'Both parties, before the work.' },
      ] },

    { h2: 'Unforeseen conditions are a category of their own' },
    { p: 'Opening a wall and finding no header, rot, knob-and-tube, or a stack that is not '
       + 'where the drawings say — these are not scope changes and they should not be priced '
       + 'like one. They are discoveries, and the proposal should already have said that '
       + 'anything behind an unopened wall is excluded.' },
    { p: 'When one turns up, the sequence is: stop, photograph it, price it, get it signed. '
       + 'The photograph is the part people skip and the part that ends the argument.' },

    { h2: 'Keeping the original honest' },
    { p: 'A change order only means something if there is a fixed thing it is changing. That '
       + 'means the signed scope has to be preserved exactly as signed — not edited, not '
       + 'updated in place, not "the latest version".' },
    { p: 'Trueline treats the signed proposal as a baseline that is never edited. Every later '
       + 'difference is a change order against it, so at any point you can show what was '
       + 'agreed, what changed, when, and who signed for each.' },
  ],
  faq: [
    { q: 'Can I do change order work before it is signed?',
      a: 'You can, and you frequently will not be paid for it. Once the work exists, the '
       + 'discussion is about whether the client owes you for something they already have. '
       + 'Signed first, every time, including the small ones.' },
    { q: 'What if the client will not sign a change order?',
      a: 'Then the work is not in scope and it does not happen. That is uncomfortable once '
       + 'and much less uncomfortable than the alternative. Keep the original scope moving and '
       + 'let the change sit unsigned.' },
    { q: 'Should a change order show the new contract total?',
      a: 'Show the price of the change on its own so it can be checked against the work. A '
       + 'running total is useful as a second line, never as the only line.' },
    { q: 'How do I handle a discovery, like rot behind a wall?',
      a: 'Stop, photograph it, price it and get it signed before continuing. The photograph is '
       + 'what makes it a discovery rather than a claim, and your proposal should already have '
       + 'excluded anything behind an unopened wall.' },
  ],
  related: ['remodeling-proposal', 'construction-estimate-template', 'read-a-contractor-quote'],
  download: 'change-order-form',
},

{
  slug: 'contractor-rate-book',
  audience: 'contractor',
  title: 'Building a rate book you can actually defend',
  metaTitle: 'How to Build a Contractor Rate Book',
  description:
    'Why unit rates beat gut pricing, how to build yours from jobs you have already '
    + 'done, and what to do about the line you have no rate for.',
  keywords: ['contractor unit rates', 'construction pricing guide', 'how to price construction work',
             'contractor rate book', 'labor and material pricing'],
  minutes: 10,
  standfirst:
    'A rate book is not a price list somebody sold you. It is what YOUR crew, on YOUR '
    + 'jobs, actually costs — and the only place it can come from is the work you have '
    + 'already won.',
  blocks: [
    { h2: 'Why a published price list is the wrong starting point' },
    { p: 'National and regional cost data is built from averages across companies with '
       + 'different crews, different overhead, different suppliers and different local '
       + 'markets. It is useful as a sanity check and dangerous as a source, because the one '
       + 'thing it cannot tell you is what YOU cost.' },
    { p: 'The second problem is defensibility. When a client asks where a number came from, '
       + '"the regional average" is a worse answer than "that is my rate, and here is the '
       + 'quantity it is multiplied by."' },

    { h2: 'The shape of a rate' },
    { p: 'One rate is a unit, a price, and the trades it covers. That is all:' },
    { table: {
        head: ['Item', 'Unit', 'What it has to cover'],
        rows: [
          ['Wall face', 'sq ft', 'Board, screws, mud, tape, labour to finish'],
          ['Ceiling', 'sq ft', 'Same, plus the difficulty of working overhead'],
          ['Floor', 'sq ft', 'Material, underlay, labour, transitions'],
          ['Baseboard', 'lf', 'Stock, fasteners, mitres, caulk, labour'],
          ['Doors', 'ea', 'Slab, jamb, casing, hardware, hanging'],
          ['Windows', 'ea', 'Trim and finish, not the unit itself unless you say so'],
        ] } },
    { p: 'Whether a rate is labour-only, labour-and-material, or material-only is a decision '
       + 'you make once and then never vary, because a book with both kinds in it and no '
       + 'label is a book that will one day quote a floor with no material in it.' },

    { h2: 'Building it from jobs you have already done' },
    { p: 'Take a job you finished and were happy with. You know what you charged. Divide it '
       + 'by the quantity you actually did, and you have a rate — a real one, from your own '
       + 'crew, at your own overhead.' },
    { formula: 'unit rate = what you charged ÷ what you actually did',
      note: 'One job gives you a number. Five jobs give you a rate. Take the middle one '
          + 'rather than the average, so a single emergency job at triple money does not move '
          + 'your book.' },
    { p: 'This is why Trueline can suggest rates without inventing any: it works them out '
       + 'from the jobs you marked won, takes the median rather than the mean, and never '
       + 'changes your book unless you tap the suggestion.' },

    { h2: 'The line with no rate against it' },
    { p: 'Every takeoff eventually produces a line you have no rate for. There are exactly '
       + 'two honest responses, and pricing it at zero is not one of them.' },
    { ul: [
        'Put a rate against it, now, even a rough one you intend to revisit.',
        'Name it on the proposal as excluded, so the client knows it is not in the number.',
      ] },
    { p: 'A quote that adds up perfectly and is silently missing a floor is the worst document '
       + 'in this trade. Trueline will not price an item at zero for this reason — an item '
       + 'with no rate is listed by name instead, on the screen and on the proposal.' },
    { shot: 'price', caption:
      'Every line is a rate you set times a quantity the room measured, with the arithmetic '
      + 'in the open.' },
  ],
  faq: [
    { q: 'Should I use national construction cost data for pricing?',
      a: 'As a sanity check, not as a source. It averages across companies with different '
       + 'crews, overhead and suppliers, so it cannot tell you what you cost — and "the '
       + 'regional average" is a much weaker answer to a client than "that is my rate".' },
    { q: 'How do I work out my unit rates?',
      a: 'Take jobs you finished and were happy with, divide what you charged by what you '
       + 'actually did, and use the median across several jobs rather than the average so one '
       + 'unusual job does not move your book.' },
    { q: 'Should rates include labour and material together?',
      a: 'Either is fine as long as every rate in the book is the same kind and it is written '
       + 'down which. Mixing them without a label is how a floor gets quoted with no material '
       + 'in it.' },
    { q: 'What do I do about an item I have no rate for?',
      a: 'Price it or exclude it — never let it come through at zero. A quote that adds up '
       + 'perfectly and is short by a floor is worse than one with a gap you can see.' },
  ],
  related: ['price-a-kitchen-remodel', 'construction-estimate-template', 'drywall-takeoff'],
  download: null,
},

{
  slug: 'price-a-kitchen-remodel',
  audience: 'contractor',
  title: 'How to price a kitchen remodel, line by line',
  metaTitle: 'How to Price a Kitchen Remodel: The Method',
  description:
    'Break the room into quantities, apply your own rates, and price the unknowns '
    + 'behind the cabinets honestly. Why per-square-foot is the wrong unit.',
  keywords: ['how to price a kitchen remodel', 'kitchen remodel estimate',
             'kitchen renovation cost breakdown', 'kitchen remodel quote'],
  minutes: 11,
  standfirst:
    'There is no per-square-foot number for a kitchen. There is a method, and it '
    + 'starts by refusing to price the room as a whole.',
  blocks: [
    { h2: 'Why a per-square-foot kitchen number is useless' },
    { p: 'Two kitchens of identical floor area can differ by a factor of four, because almost '
       + 'nothing expensive in a kitchen scales with floor area. Cabinets are linear feet of '
       + 'run. Counters are square feet of top. Appliances are a count. Plumbing and electrical '
       + 'are about how far things move, not how big the room is.' },
    { p: 'A square-foot figure is a way of pricing the one thing in the room that costs the '
       + 'least.' },

    { h2: 'Break it into quantities first' },
    { table: {
        head: ['What', 'Unit', 'Where it comes from'],
        rows: [
          ['Floor', 'sq ft', 'The floor outline, including under the toe kicks'],
          ['Wall face', 'sq ft', 'Perimeter × height, less openings — including behind cabinets'],
          ['Ceiling', 'sq ft', 'Follows the floor'],
          ['Base and trim', 'lf', 'Perimeter less doors and cased openings, less cabinet runs'],
          ['Cabinet run', 'lf', 'Measured along the wall, base and upper separately'],
          ['Counter', 'sq ft', 'Top area, plus a separate count of edges and cut-outs'],
          ['Backsplash', 'sq ft', 'Run × height, which is not the wall face'],
          ['Doors, windows, openings', 'ea', 'Counted'],
          ['Appliances', 'ea', 'Counted, with who supplies each one written down'],
        ] } },
    { p: 'Board goes behind cabinets, so wall face does not get reduced by the cabinet run — '
       + 'but base does, because base stops at a cabinet. This is one of the places a takeoff '
       + 'most reliably goes wrong.' },

    { h2: 'The things that are only true of kitchens' },
    { ul: [
        'Moving a sink, a stack or a gas line is the single biggest swing in the price, and it is invisible until somebody opens a wall.',
        'Electrical in a kitchen is code-driven — circuits, GFCI, appliance loads — rather than driven by room size.',
        'A soffit above the uppers is either coming out or staying, and the two answers price very differently.',
        'The floor under the appliances and the toe kicks is floor, and it is missed constantly.',
        'Counter cut-outs and edge profiles are priced per item, not per square foot.',
      ] },

    { h2: 'Pricing the unknowns honestly' },
    { p: 'A kitchen has more behind-the-wall risk than any other room in a house. The way to '
       + 'price that is not to pad the number invisibly — it is to name it.' },
    { p: 'Exclude what you cannot see, in the proposal, in plain words: anything behind a wall '
       + 'nobody has opened, any existing plumbing or wiring that turns out not to be to code, '
       + 'any rot or damage found on demolition. Then, when one turns up, it is a change order '
       + 'against an exclusion you already wrote rather than a fight.' },

    { h2: 'Then it is multiplication' },
    { p: 'Quantities from the room, rates from your own book, and the arithmetic in the open '
       + 'so a client can follow it. Every line a number you set times a number the room '
       + 'measured — and both defensible on their own.' },
  ],
  faq: [
    { q: 'How much does a kitchen remodel cost per square foot?',
      a: 'This is the wrong unit and any figure quoted against it will be wrong. Almost '
       + 'nothing expensive in a kitchen scales with floor area — cabinets are linear feet, '
       + 'counters are top area, appliances are a count, and moving plumbing is the biggest '
       + 'single swing. Price the quantities, not the room.' },
    { q: 'Do you deduct cabinet runs from wall square footage?',
      a: 'No — board goes behind the cabinets. You do deduct cabinet runs from base and trim, '
       + 'because base stops at a cabinet. Getting these two the wrong way round is a common '
       + 'takeoff error.' },
    { q: 'What is the biggest risk in a kitchen estimate?',
      a: 'Anything behind a wall: moving a sink or a stack, wiring that is not to code, rot '
       + 'found on demolition. Exclude it explicitly in the proposal rather than padding for '
       + 'it invisibly, so a discovery becomes a change order rather than an argument.' },
  ],
  related: ['contractor-rate-book', 'drywall-takeoff', 'kitchen-remodel-cost-drivers'],
  download: null,
},

];
