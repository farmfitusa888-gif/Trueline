/**
 * Guides for restoration and water-damage crews.
 *
 * The highest-urgency, highest-spend audience this product has, and the one
 * whose documents get read by somebody paid to find fault with them.
 *
 * ## The standard of care in here
 *
 * Where these describe the IICRC S500 they describe it in general terms and
 * point at the standard itself. Nothing here paraphrases a specific clause,
 * quotes a drying time, or states a threshold — the S500 is a purchased,
 * revised document and a number lifted out of a blog post and reprinted here
 * would be exactly the kind of laundered guess this project refuses to make.
 * What these teach is what to record and why, which is where crews actually
 * lose claims.
 */
export const RESTORATION = [

{
  slug: 'document-water-damage',
  audience: 'restoration',
  title: 'How to document water damage for an insurance claim',
  metaTitle: 'Document Water Damage for an Insurance Claim',
  description:
    'What to photograph, what to measure, what to log and in what order — on the '
    + 'first visit, before anything gets cut out or dried.',
  keywords: ['how to document water damage', 'water damage insurance claim documentation',
             'water damage photos for insurance', 'restoration documentation'],
  minutes: 12,
  standfirst:
    'Everything you can measure again later, you can measure again later. The '
    + 'photograph of a wet wall before it came out is the only thing on the job that '
    + 'cannot be recreated by anybody, ever.',
  blocks: [
    { h2: 'The order matters more than the effort' },
    { p: 'Crews rarely under-document. They document in the wrong order — thoroughly, after '
       + 'the demolition, when the evidence that mattered is in a skip. Work outwards from '
       + 'the thing that is about to disappear.' },
    { steps: [
        { h3: 'Photograph the damage before anything moves',
          p: 'Wide shot of the room, then the damage in context, then close. Include something '
           + 'for scale. Do this before furniture is moved, before anything is cut, before the '
           + 'first fan goes in.' },
        { h3: 'Find and photograph the source',
          p: 'The supply line, the appliance, the roof penetration. A claim without a source '
           + 'is a claim about a wet floor of unknown origin, and coverage frequently turns on '
           + 'exactly that question.' },
        { h3: 'Take the first moisture readings',
          p: 'Before drying starts, on affected material and on unaffected material of the '
           + 'same type. The unaffected reading is what turns the affected one into evidence.' },
        { h3: 'Measure the affected area',
          p: 'Which walls, how far up, how far along. This is the number that becomes '
           + 'square feet of board and feet of base on the estimate.' },
        { h3: 'Record dates',
          p: 'The date of loss and the date it was found, separately. They are often not the '
           + 'same day and the gap is frequently the argument.' },
        { h3: 'Then start work',
          p: 'And keep logging readings on the same points, on the same scale, every visit.' },
      ] },

    { h2: 'What a photograph has to have in it' },
    { ul: [
        'A wide shot that establishes which room and which wall, so a close-up of staining is locatable six weeks later.',
        'Something of known size in frame — a tape, a moisture meter, a standard outlet.',
        'The meter reading visible in the same frame as the material being read, where you can manage it.',
        'The source, from far enough back to show what it is connected to.',
      ] },
    { note: 'A close-up of a stain with nothing around it proves that a stain existed. It '
          + 'does not prove where, how big, or in whose house — and an adjuster reading a '
          + 'file of forty such photographs cannot build a room out of them.' },

    { h2: 'Measurements that survive the demolition' },
    { p: 'The affected area is the number the estimate hangs on, and it is the one people '
       + 'reconstruct from memory afterwards. Record it as: which wall, how far up from the '
       + 'floor the damage was seen, and how far along the wall it runs. Everything else — '
       + 'square feet of face, feet of base, whether the ceiling is involved — comes out of '
       + 'those three plus the room.' },
    { p: 'This is what ScanToBid does with a mark: you point the phone at the damage and tap '
       + 'it while you are standing there, and because the app already knows how long that '
       + 'wall is, the area works itself out. The photograph is taken at the instant of the '
       + 'tap rather than afterwards, from where you were standing.' },
    { shot: 'claim', caption:
      'The damage, on the room it belongs to, with the areas worked out from measurements '
      + 'rather than typed in from memory.' },

    { h2: 'The file you hand over' },
    { p: 'One document, in one order: what happened and when, the room and its measurements, '
       + 'each damage with its area and its photographs, the moisture log over time, and what '
       + 'you propose to do. An adjuster who has to assemble that from an email with '
       + 'twenty-eight attachments will assemble it wrong.' },
  ],
  faq: [
    { q: 'What photographs do I need for a water damage claim?',
      a: 'A wide shot establishing the room, the damage in context, close-ups with something '
       + 'for scale, and the source of the water. Take all of them before anything is moved, '
       + 'cut or dried — those are the only images on the job that cannot be recreated.' },
    { q: 'Should I take moisture readings before drying starts?',
      a: 'Yes, and take them on unaffected material of the same type at the same time. A '
       + 'reading of 18% means nothing on its own; 18% against a dry standard of 8% in the '
       + 'same room is evidence.' },
    { q: 'How do I record the affected area?',
      a: 'Which wall, how far up from the floor, how far along. Every derived figure — face '
       + 'area, feet of base, whether the ceiling is involved — comes out of those three plus '
       + 'the room’s own dimensions, and they can be checked later.' },
    { q: 'What is the most common documentation mistake?',
      a: 'Documenting thoroughly but in the wrong order — after demolition. Anything you can '
       + 'measure again, you can measure again. The wall before it came out, you cannot.' },
  ],
  related: ['water-damage-categories', 'moisture-readings-log', 'loss-description'],
  download: 'damage-log',
},

{
  slug: 'water-damage-categories',
  audience: 'restoration',
  title: 'Water damage categories and classes, explained plainly',
  metaTitle: 'Water Damage Categories 1, 2 and 3 Explained',
  description:
    'What Category 1, 2 and 3 mean, how a category degrades over time, how classes '
    + 'differ from categories, and why the distinction decides your scope.',
  keywords: ['water damage categories', 'category 1 2 3 water', 'black water grey water',
             'water damage classes', 'IICRC water categories'],
  minutes: 9,
  standfirst:
    'Category is about what is in the water. Class is about how hard it will be to '
    + 'dry. They are two different axes and any category can pair with any class.',
  blocks: [
    { h2: 'The three categories' },
    { p: 'The IICRC S500 — the standard the industry works to — sorts water by how '
       + 'contaminated it is. There are three categories and there is no category 4.' },
    { table: {
        head: ['Category', 'What it is', 'Typical source'],
        rows: [
          ['Category 1', 'Water from a sanitary source, posing no substantial risk from contact, ingestion or inhalation',
           'Supply line, tub overflow with no additives, appliance intake'],
          ['Category 2', 'Water carrying significant contamination, capable of causing illness on contact or ingestion (once called "grey water")',
           'Dishwasher or washing-machine discharge, toilet overflow with urine only'],
          ['Category 3', 'Grossly contaminated water carrying pathogens, toxins or other harmful agents (once called "black water")',
           'Sewage, rising ground water, water from beyond the trap'],
        ] } },

    { h2: 'A category is not fixed — it degrades' },
    { p: 'This is the part that catches people out on the second visit. Clean Category 1 '
       + 'water does not stay Category 1 sitting in a warm wall cavity. Bacteria grow, and '
       + 'commonly quoted guidance puts the drift to Category 2 within roughly two to three '
       + 'days if it is not dried.' },
    { p: 'Temperature, what the water is sitting in, and how long it has been there all move '
       + 'that. Which is why the date of loss and the date it was found have to be recorded '
       + 'separately, and why a job that sat over a weekend is not the job that was called in.' },
    { note: 'If you scope a job as Category 1 on Friday and open the wall on Monday, the '
          + 'thing you are looking at may no longer be a Category 1 job — and the '
          + 'documentation showing when the water arrived is what justifies the change in '
          + 'scope.' },

    { h2: 'Classes are a different question' },
    { p: 'Where category asks what is in the water, class asks how much material is wet and '
       + 'how hard it will be to get dry. The S500 runs classes 1 to 4, from the smallest '
       + 'scope up to specialty drying for materials that hold water tightly — hardwood, '
       + 'plaster, concrete and similar.' },
    { p: 'The two are independent. A small Category 3 job can be a Class 1. A very large '
       + 'Category 1 loss into a hardwood floor can be a Class 4. Scope, equipment and '
       + 'personal protective equipment come out of both together, not from either alone.' },

    { h2: 'Why the distinction decides your estimate' },
    { p: 'Category drives what has to be removed rather than dried, what protection the crew '
       + 'needs, and what happens to porous materials. Class drives how much equipment, for '
       + 'how long. An estimate that names both, with the date the water arrived and the date '
       + 'it was found, is answering the adjuster’s first two questions before they are asked.' },
    { p: 'ScanToBid records the category on the damage itself rather than on a note, so it '
       + 'travels onto the claim document beside the area it applies to.' },
  ],
  faq: [
    { q: 'Is there a Category 4 water damage?',
      a: 'No. The IICRC S500 defines three categories — 1, 2 and 3. It is classes that run to '
       + '4, and classes describe drying difficulty rather than contamination.' },
    { q: 'How long before Category 1 water becomes Category 2?',
      a: 'Commonly cited guidance is roughly 24 to 72 hours, but it depends on temperature, '
       + 'what the water is sitting in and how much of it there is. The practical takeaway is '
       + 'to record when the water arrived and when it was found, because that gap is what '
       + 'justifies your category later.' },
    { q: 'What is the difference between a category and a class?',
      a: 'Category is what is in the water — how contaminated it is. Class is how much '
       + 'material is wet and how hard it will be to dry. They are independent: any category '
       + 'can occur at any class.' },
    { q: 'Is grey water the same as Category 2?',
      a: 'Grey and black water are the older informal terms for Category 2 and Category 3. '
       + 'The standard uses the numbered categories, and so should anything you hand an '
       + 'adjuster.' },
  ],
  related: ['document-water-damage', 's500-drying', 'flood-cut-height'],
  download: null,
},

{
  slug: 's500-drying',
  audience: 'restoration',
  title: 'What the IICRC S500 asks of your documentation',
  metaTitle: 'IICRC S500: What It Asks of Your Documentation',
  description:
    'The S500 is a standard of care, not a recipe. What it means for what you record, '
    + 'why a dry standard matters, and how to keep a defensible drying log.',
  keywords: ['IICRC S500', 'water damage restoration standard', 'drying standard',
             'dry standard moisture', 'restoration documentation standard'],
  minutes: 10,
  standfirst:
    'The S500 does not tell you a room is dry at a number. It tells you to establish '
    + 'what dry means in that building and then show that you got there.',
  blocks: [
    { h2: 'It is a standard of care' },
    { p: 'The S500 is the water damage restoration industry’s consensus document, published '
       + 'and periodically revised by the IICRC. It describes the principles a competent '
       + 'restorer is expected to work to, and it is written as a standard of care rather '
       + 'than a set of fixed thresholds you can print on a card.' },
    { p: 'That framing matters for documentation. Because it does not hand you a universal '
       + '"dry" number, what you are expected to produce is evidence: what the dry standard '
       + 'was in this building, what the affected materials read, and how those readings moved '
       + 'over the course of the job.' },
    { note: 'Buy the standard rather than working from summaries. It is revised, it is '
          + 'specific, and an adjuster who works to it will know which edition you are '
          + 'quoting. Nothing on this page substitutes for reading it.' },

    { h2: 'The dry standard is the whole trick' },
    { p: 'A moisture reading on its own is a number without a meaning. What makes it evidence '
       + 'is a comparison: the same material, same meter, same scale, somewhere in the same '
       + 'building that was not affected.' },
    { p: 'Establish that reading first, write it down, and use it as the target. "Wall reads '
       + '17%" says nothing. "Wall reads 17% against an unaffected dry standard of 9% on the '
       + 'same wall type" is an argument.' },

    { h2: 'What a defensible drying log looks like' },
    { ul: [
        'The same points, marked and identified, on every visit — not "the north wall" on Monday and "by the window" on Thursday.',
        'The same meter and the same scale throughout. A log that switches between %MC and a relative scale cannot be drawn as a curve.',
        'A date and time on every reading.',
        'The dry standard recorded alongside, so every reading has something to be compared to.',
        'Ambient conditions where you take them — temperature and humidity affect what the numbers mean.',
      ] },
    { p: 'A log that satisfies all of that can be shown as a falling curve, and a falling '
       + 'curve is the single most persuasive object in a water file. A log that switches '
       + 'scales halfway cannot be drawn at all.' },
    { p: 'ScanToBid logs readings against the damage they belong to, keeps the scale with each '
       + 'reading, and refuses to draw a curve across a scale change — it lists them instead '
       + 'and says why. A curve drawn across two different scales is not a curve.' },

    { h2: 'When drying stops' },
    { p: 'Not on a fixed day, and not when the equipment has been in for the number of days '
       + 'the estimate assumed. It stops when the affected materials reach the dry standard '
       + 'you established, and the log is what shows they did.' },
  ],
  faq: [
    { q: 'What moisture content counts as dry?',
      a: 'There is no universal number, which is exactly why the standard asks you to '
       + 'establish a dry standard from unaffected material of the same type in the same '
       + 'building. That reading is the target, and the comparison is what makes your other '
       + 'readings mean anything.' },
    { q: 'How often should moisture readings be taken?',
      a: 'On every visit while equipment is in place, at the same identified points, with the '
       + 'same meter and scale. Consistency is worth more than frequency — a daily log that '
       + 'moves the points around proves less than a regular one that does not.' },
    { q: 'Do I need to buy the S500?',
      a: 'If you are doing this work commercially, yes. It is revised periodically, the '
       + 'detail matters, and adjusters who work to it will know which edition you are '
       + 'referring to. Summaries — including this page — are orientation, not the standard.' },
  ],
  related: ['moisture-readings-log', 'water-damage-categories', 'document-water-damage'],
  download: 'damage-log',
},

{
  slug: 'loss-description',
  audience: 'restoration',
  title: 'How to write a loss description an adjuster can use',
  metaTitle: 'How to Write a Loss Description for a Claim',
  description:
    'The first thing an adjuster reads. What belongs in it, what does not, and the '
    + 'structure that answers their questions before they ask them.',
  keywords: ['loss description', 'how to write a loss description', 'insurance claim narrative',
             'water damage loss description example'],
  minutes: 8,
  standfirst:
    'An adjuster reads the loss description first and everything else through it. '
    + 'Two paragraphs, in the right order, decide how the rest of your file lands.',
  blocks: [
    { h2: 'Two paragraphs, in this order' },
    { p: 'The first says what happened, where, and when. The second says what condition it '
       + 'left things in. Resist merging them — an adjuster is answering two separate '
       + 'questions and merging them makes both harder.' },
    { steps: [
        { h3: 'What happened',
          p: 'The source, the room or rooms, the date it occurred and the date it was found. '
           + 'Plain past tense. "The supply line to the dishwasher failed overnight on 14 '
           + 'March and was found the following morning."' },
        { h3: 'What condition it is in',
          p: 'Which materials are affected, where, and how far. "Water tracked under the '
           + 'cabinets into the adjoining hall. Drywall is affected to approximately 18 '
           + 'inches on the north and east walls; the floor is affected throughout."' },
      ] },

    { h2: 'What does not belong in it' },
    { ul: [
        'Your scope of work. That is a different section and putting it here reads as pre-judging the claim.',
        'Coverage opinions. Whether something is covered is not your call and saying so weakens everything around it.',
        'Adjectives. "Catastrophic", "severe", "extensive" — an adjuster discounts them automatically and they cost you credibility for the numbers that follow.',
        'Numbers you have not measured. If the area is on the estimate, it does not need estimating again in prose.',
      ] },
    { note: 'The most common failure is length. A loss description that runs to a page of '
          + 'narrative gets skimmed, and the two facts that mattered — source and dates — get '
          + 'skimmed with it.' },

    { h2: 'Dates, separately, always' },
    { p: 'Date of loss and date discovered are different fields for a reason. The gap between '
       + 'them affects category, it affects what could reasonably have been prevented, and it '
       + 'is frequently the thing a claim turns on. Guessing either is worse than saying "found '
       + 'on 15 March; date of occurrence not established".' },

    { h2: 'Writing it while you are standing there' },
    { p: 'The best version of this paragraph is written in the room, not at a desk three days '
       + 'later from memory and a phone full of photographs.' },
    { p: 'On an iPhone that supports Apple Intelligence, ScanToBid will draft this for you from '
       + 'what it already holds — the cause, the dates, and every mark with its kind, its '
       + 'category and its measured area — running entirely on the phone with nothing sent '
       + 'anywhere. It writes sentences; every figure in them came off the room. You read it '
       + 'and change anything that is not how you would put it, because it goes out in your '
       + 'name.' },
    { h2: 'Two worked examples' },
    { p: 'The difference between a description that works and one that does not is almost '
       + 'never effort. It is order and restraint.' },
    { table: {
        head: ['Weak', 'Why'],
        rows: [
          ['“Catastrophic water event caused extensive damage throughout the property.”',
           'No source, no dates, no rooms, and three adjectives an adjuster will discount.'],
          ['“Water damage to kitchen and hall. Drywall and flooring affected. Recommend full replacement of affected materials and drying of structure.”',
           'Better, but it has run into scope in the last sentence and still has no source and no dates.'],
        ] } },
    { p: 'The same loss, written to be used:' },
    { note: '<strong>What happened.</strong> The supply line to the dishwasher failed '
          + 'overnight on 14 March and was found the following morning.<br><br>'
          + '<strong>Condition.</strong> Water tracked from under the kitchen cabinets into the '
          + 'adjoining hall. Drywall is affected to approximately 18 inches on the north and '
          + 'east walls of the kitchen; the flooring is affected throughout both rooms. '
          + 'Moisture readings were taken before drying began and are logged separately.' },
    { p: 'Source, two dates, two rooms, the materials, how far up, and a pointer to the '
       + 'evidence. No adjectives, no coverage opinion, no scope.' },

    { h2: 'What to do when you do not know something' },
    { p: 'Say so, in the document. "Date of occurrence not established; first observed 15 '
       + 'March" is a much stronger position than a date that turns out to be wrong, and it is '
       + 'far stronger than silence — silence reads as an omission rather than as a limit on '
       + 'what anybody knows.' },
    { p: 'The same applies to the source. "Failure at the supply line to the dishwasher" and '
       + '"origin not determined; water first observed at the base of the dishwasher cabinet" '
       + 'are both usable. Guessing between them is not.' },
  ],
  faq: [
    { q: 'How long should a loss description be?',
      a: 'Two short paragraphs. Anything longer gets skimmed, and what gets skimmed with it '
       + 'is usually the source and the dates — the two things the adjuster most needed.' },
    { q: 'Should the loss description include my scope of work?',
      a: 'No. Keep them separate. A loss description that runs into scope reads as pre-judging '
       + 'the claim, and the adjuster is answering a different question at that point.' },
    { q: 'What if I do not know the date of loss?',
      a: 'Say so plainly and give the date it was found. "Date of occurrence not established" '
       + 'is a much stronger position than a guess that later turns out to be wrong.' },
    { q: 'Can you give an example of a good loss description?',
      a: 'Source, dates, rooms, materials and how far — with no adjectives and no scope. For '
       + 'example: "The supply line to the dishwasher failed overnight on 14 March and was '
       + 'found the following morning. Water tracked from under the kitchen cabinets into the '
       + 'adjoining hall; drywall is affected to approximately 18 inches on the north and east '
       + 'walls, and the flooring is affected throughout both rooms."' },
    { q: 'What if I do not know the source of the water?',
      a: 'Write what you do know and say the rest is not established. "Origin not determined; '
       + 'water first observed at the base of the dishwasher cabinet" is usable and honest. A '
       + 'guess that later turns out to be wrong is much worse than a stated limit.' },
  ],
  related: ['document-water-damage', 'adjusters-look-for', 'water-damage-categories'],
  download: null,
},

{
  slug: 'xactimate-esx-import',
  audience: 'restoration',
  title: 'Getting a sketch into Xactimate: what an ESX file is',
  metaTitle: 'Xactimate ESX Import: What the File Actually Is',
  description:
    'What an ESX contains, what carries across from a room sketch and what does not, '
    + 'and how to avoid re-drawing rooms you have already measured.',
  keywords: ['xactimate esx', 'esx file import', 'xactimate sketch import',
             'import room sketch to xactimate', 'esx export'],
  minutes: 9,
  standfirst:
    'Re-drawing a room in Xactimate that you already walked with a phone is the '
    + 'single most avoidable hour in restoration estimating.',
  blocks: [
    { h2: 'What an ESX is' },
    { p: 'ESX is the file format Xactimate uses to move an estimate between machines and '
       + 'between people. Underneath, it is a container holding the estimate’s structured data '
       + '— including the sketch: rooms, their dimensions, and how they connect.' },
    { p: 'That is what makes it interesting to anybody who has already measured the building '
       + 'with something else. If the geometry can go in as data, nobody has to re-draw it.' },

    { h2: 'What carries across, and what does not' },
    { table: {
        head: ['Thing', 'Travels in an ESX?'],
        rows: [
          ['Room dimensions and shape', 'Yes — this is the point'],
          ['Room names', 'Yes'],
          ['Ceiling height', 'Yes'],
          ['Door and window openings', 'Yes, as part of the sketch'],
          ['Your line items and pricing', 'Yes, if the estimate has them'],
          ['Photographs', 'Depends on how the estimate was assembled — do not assume'],
          ['Your own moisture log', 'No — that is your documentation, not Xactimate’s'],
        ] } },
    { note: 'Import is not a substitute for reviewing. Whatever comes in should be checked '
          + 'against the room before it is priced, exactly as a sketch drawn by hand would be.' },

    { h2: 'The workflow that saves the hour' },
    { steps: [
        { h3: 'Measure once, on site',
          p: 'Walk the room, mark the damage while standing in front of it, put a tape on one '
           + 'wall running each way.' },
        { h3: 'Export the geometry',
          p: 'An ESX carrying the rooms and their dimensions.' },
        { h3: 'Import and price in Xactimate',
          p: 'The sketch is already there. You are pricing, not drawing.' },
        { h3: 'Keep your own documentation separate',
          p: 'Photographs, moisture readings and the loss narrative live in your file. The '
           + 'estimate is one document in a claim, not the whole claim.' },
      ] },

    { h2: 'Why the measurements have to be honest first' },
    { p: 'An ESX will carry whatever geometry you give it, including geometry a phone guessed '
       + 'at. Once it is inside an estimating package it looks exactly like geometry somebody '
       + 'measured, because the format has nowhere to record the difference.' },
    { p: 'That is the argument for settling it before export. ScanToBid keeps each wall’s '
       + 'provenance visible right up to the moment you export — and the app will tell you '
       + 'which walls have never had a tape on them, so the decision to export anyway is a '
       + 'decision rather than an oversight.' },
    { h2: 'Check these five things after any import' },
    { steps: [
        { h3: 'Room names',
          p: 'They travel, and they are frequently whatever the capturing app called them — '
           + '"Room 3" is not a room name an adjuster can work with.' },
        { h3: 'Ceiling heights',
          p: 'The single value most likely to be a default rather than a measurement. Check '
           + 'every room, not the first one.' },
        { h3: 'Openings',
          p: 'Doors and windows carry across as part of the sketch. Confirm the count against '
           + 'the room, because a missed opening is a deduction that never happens.' },
        { h3: 'Anything the capture guessed at',
          p: 'Bay windows, curved walls, deep bulkheads. These are where an automated capture '
           + 'produces a clean, confident, wrong shape.' },
        { h3: 'Whether the geometry was ever measured',
          p: 'An ESX has nowhere to record this, so it has to come from you. Whatever you '
           + 'imported now looks exactly like something somebody taped.' },
      ] },

    { h2: 'What the format cannot tell you' },
    { p: 'This is the part worth sitting with. An ESX is a container for structured estimate '
       + 'data, and there is no field in it that says "this wall was scanned and never '
       + 'checked". Once geometry is inside an estimating package it is indistinguishable from '
       + 'geometry somebody measured, and every number derived from it inherits that.' },
    { p: 'Which means the discipline has to happen before export, not after. Settle which walls '
       + 'have had a tape on them, fix the ones that matter, and then export — because after '
       + 'that, the information is gone.' },
    { p: 'ScanToBid is deliberately noisy about this on the way out: it will tell you which '
       + 'walls have never been measured at the point you ask for an export, so exporting '
       + 'anyway is a decision somebody made rather than something that happened.' },
  ],
  faq: [
    { q: 'What is an ESX file?',
      a: 'It is the file Xactimate uses to move an estimate between machines and people. It '
       + 'holds the estimate’s structured data including the sketch — rooms, dimensions and '
       + 'how they connect — which is why it is the useful format for getting a room you '
       + 'measured elsewhere into Xactimate without re-drawing it.' },
    { q: 'Can I import a phone room scan into Xactimate?',
      a: 'If the app can produce an ESX carrying the sketch geometry, yes. Check what came in '
       + 'against the room before pricing it, the same as you would a sketch drawn by hand.' },
    { q: 'Do photographs travel in an ESX?',
      a: 'It depends on how the estimate was assembled, so do not assume they will. Keep your '
       + 'photographic documentation in your own file regardless — the estimate is one '
       + 'document in a claim rather than the whole claim.' },
    { q: 'What should I check after importing a sketch into Xactimate?',
      a: 'Room names, ceiling heights on every room rather than the first, the opening count '
       + 'against the actual room, anything unusual the capture had to guess at, and — most '
       + 'importantly — whether the geometry was ever physically measured.' },
    { q: 'Does an ESX record whether measurements were taken with a tape?',
      a: 'No. There is no field for it, so once geometry is inside an estimating package it is '
       + 'indistinguishable from geometry somebody measured. That is why the decision has to be '
       + 'made before export.' },
  ],
  related: ['document-water-damage', 'measure-water-damaged-drywall', 'adjusters-look-for'],
  download: null,
},

{
  slug: 'moisture-readings-log',
  audience: 'restoration',
  title: 'Keeping a moisture log that proves the building dried',
  metaTitle: 'Moisture Reading Log: Keeping It Defensible',
  description:
    'Same points, same meter, same scale. Why a dry standard is required, what to '
    + 'record at each visit, and the one mistake that makes a log unusable.',
  keywords: ['moisture reading log', 'drying log template', 'moisture meter readings',
             'dry standard', 'water damage drying documentation'],
  minutes: 8,
  standfirst:
    'A drying log is only worth keeping if it can be drawn as a falling line. Most of '
    + 'the ways they go wrong make that impossible.',
  blocks: [
    { h2: 'What every reading needs beside it' },
    { ul: [
        'Where — an identified point, marked on the wall and named the same way every visit.',
        'When — date and time.',
        'What material — drywall, framing, subfloor, hardwood. They dry differently and read differently.',
        'What meter and what scale — %MC, a relative scale, pin or pinless.',
        'The dry standard for that material in that building.',
      ] },
    { p: 'Drop any one of those and the reading becomes a number in a notebook. Drop the '
       + 'scale and the whole log becomes undrawable.' },

    { h2: 'The mistake that ruins a log' },
    { p: 'Switching scales partway through. A relative scale on Monday and %MC on Thursday '
       + 'cannot be compared, cannot be plotted, and cannot be shown to an adjuster as a '
       + 'drying curve — because a line drawn across a scale change is not measuring anything.' },
    { note: 'ScanToBid keeps the scale with each reading and will not draw a curve across a '
          + 'change of scale. It lists the readings instead and says why. That is deliberate: '
          + 'a curve that quietly spans two scales is worse than no curve, because it looks '
          + 'like evidence.' },

    { h2: 'Why the dry standard has to be recorded first' },
    { p: 'A reading is a comparison or it is nothing. Take the dry standard from unaffected '
       + 'material of the same type in the same building, on the same meter, before drying '
       + 'starts, and write it at the top of the log. Every reading afterwards is measured '
       + 'against it.' },
    { formula: 'evidence = affected reading vs dry standard, over time',
      note: 'Not "17% is wet". 17% against a dry standard of 9% on the same wall type, falling '
          + 'to 10% over six days.' },

    { h2: 'What to do at each visit' },
    { steps: [
        { h3: 'Read the same points', p: 'The ones you marked. Not near them.' },
        { h3: 'Read the dry standard again', p: 'It moves with the weather. A rising dry '
          + 'standard explains an affected reading that stops falling.' },
        { h3: 'Record ambient conditions', p: 'Temperature and relative humidity where you '
          + 'are taking the readings.' },
        { h3: 'Note what changed', p: 'Equipment moved, added, removed. A flat day with a '
          + 'reason recorded is a flat day; a flat day with nothing beside it looks like '
          + 'nobody attended.' },
      ] },

    { h2: 'When to stop' },
    { p: 'When the affected materials reach the dry standard you established — not on a fixed '
       + 'day and not when the equipment has been in for as long as the estimate assumed. The '
       + 'log is what shows they did, which is why it has to be capable of being drawn.' },
  ],
  faq: [
    { q: 'What is a dry standard?',
      a: 'A reading taken from unaffected material of the same type, in the same building, on '
       + 'the same meter and scale, before drying starts. It is the target the affected '
       + 'readings are being compared against, and without it a moisture reading has no '
       + 'meaning.' },
    { q: 'Can I switch moisture meters partway through a job?',
      a: 'Avoid it. Different meters and different scales cannot be plotted as one curve, and '
       + 'a log that cannot be drawn as a falling line is much harder to defend. If you must, '
       + 'record the change explicitly and keep the two series separate.' },
    { q: 'How many readings should a drying log have?',
      a: 'Enough to show a trend at the same identified points — which in practice means every '
       + 'visit while equipment is in place. Consistency of point and scale matters more than '
       + 'the raw number of readings.' },
  ],
  related: ['s500-drying', 'document-water-damage', 'water-damage-categories'],
  download: 'damage-log',
},

{
  slug: 'flood-cut-height',
  audience: 'restoration',
  title: 'Flood cuts: choosing a height and defending it',
  metaTitle: 'Flood Cut Height: How to Choose and Justify It',
  description:
    'Why cuts go to a convenient height rather than the water line, how category '
    + 'changes it, and recording what was seen against what was decided.',
  keywords: ['flood cut', 'flood cut height', 'drywall flood cut 2 foot 4 foot',
             'water damage drywall removal height'],
  minutes: 7,
  standfirst:
    'What the water did and what you cut are two different facts, and an estimate '
    + 'that records only one of them is missing the part that gets questioned.',
  blocks: [
    { h2: 'Why cuts are made at a convenient height' },
    { p: 'Water tracks up drywall unevenly, so the visible line is ragged. Nobody cuts along a '
       + 'ragged line: board comes in fixed dimensions, and a cut at two feet or four feet '
       + 'means the replacement goes back as a clean horizontal strip that can be taped and '
       + 'finished properly.' },
    { p: 'That is trade practice, not a standard. It is a decision the contractor makes about '
       + 'how to do the repair well.' },

    { h2: 'What was seen, and what was decided' },
    { p: 'Those are two records and they should stay apart:' },
    { table: {
        head: ['Record', 'What it is', 'Who it is for'],
        rows: [
          ['Damage observed', 'The water line, as high as it actually went, with photographs',
           'The adjuster — this is the loss'],
          ['Cut height', 'Where you are cutting, and why', 'The estimate — this is the repair'],
        ] } },
    { p: 'An estimate that only records the cut height invites the question "why is this four '
       + 'feet when the water was fourteen inches?", and the answer — that a 4 ft cut is how a '
       + 'strip of board goes back properly — lands much better when the fourteen inches is '
       + 'documented right beside it.' },
    { note: 'ScanToBid keeps these as separate fields on the same damage: what the water was '
          + 'seen to reach, and the height you have decided to cut to. The claim document '
          + 'prints both and says which figure the scope used.' },

    { h2: 'Category changes the decision' },
    { p: 'On a Category 1 loss the question is genuinely about drying versus removal. On '
       + 'Category 3 it is not — grossly contaminated water reaches porous materials that '
       + 'cannot be cleaned in place, and the scope reflects that regardless of how far up the '
       + 'staining goes.' },
    { p: 'Which is another reason the category, the date of loss and the date found all belong '
       + 'in the file: they justify a scope decision that would otherwise look like padding.' },

    { h2: 'Insulation, and what is behind the board' },
    { p: 'Wet insulation in a cavity is its own line and its own decision, and it is invisible '
       + 'until the board is off. Photograph it at the moment of removal — it is the same rule '
       + 'as everything else in this trade: the things that disappear get documented first.' },
    { h2: 'Two feet or four feet?' },
    { p: 'Both are common and the choice is usually driven by three things: how high the '
       + 'affected material actually goes, what height lets the replacement strip go back '
       + 'cleanly, and whether there is anything on the wall — outlets, cabinets, a chair rail '
       + '— that makes one height much easier to finish than the other.' },
    { table: {
        head: ['Consideration', 'Pushes towards'],
        rows: [
          ['Water line under about 16 in', 'A 2 ft cut'],
          ['Water line above 2 ft anywhere on the run', 'A 4 ft cut across the whole run'],
          ['Outlets in the affected band', 'Cutting above them, so the box is not on the seam'],
          ['Insulation to be removed and replaced', 'Whatever gives access — often higher'],
          ['A chair rail or wainscot', 'Cutting to the trim line, which is its own decision'],
        ] } },
    { note: 'Cutting at different heights along one continuous run creates a stepped seam that '
          + 'is hard to finish and obvious afterwards. Pick one height for the run.' },

    { h2: 'Documenting the decision itself' },
    { p: 'Write the reason down at the time, in a sentence. "Cut at 4 ft: water observed to '
       + '26 in on the north wall and outlets at 14 in would otherwise fall on the seam." That '
       + 'sentence costs ten seconds on site and answers a question that will otherwise be '
       + 'asked in writing three weeks later.' },
    { p: 'This is the same principle as everything else in a water file: the reasoning is '
       + 'cheap to record while you are standing there and expensive to reconstruct.' },
  ],
  faq: [
    { q: 'How high should a flood cut be?',
      a: 'High enough to get above the affected material, and at a height a strip of board can '
       + 'go back at cleanly — which is why two feet and four feet are common. Record the water '
       + 'line you actually observed separately from the height you chose to cut.' },
    { q: 'Why cut higher than the water line?',
      a: 'Because board goes back as a horizontal strip and a ragged cut cannot be finished '
       + 'properly. That is a repair decision, and it is easiest to justify when the observed '
       + 'damage is documented right beside it.' },
    { q: 'Do you always cut on a Category 3 loss?',
      a: 'Grossly contaminated water reaching porous materials generally means removal rather '
       + 'than cleaning in place, and the scope reflects that. The specifics are what the S500 '
       + 'is for — and what your documentation of category and timing has to support.' },
    { q: 'Should a flood cut be 2 feet or 4 feet?',
      a: 'Whichever gets above the affected material and lets a strip of board go back cleanly. '
       + 'Under about 16 inches of water line usually means 2 ft; anything above 2 ft on the '
       + 'run means 4 ft across the whole run. Outlets in the band push you higher, so the box '
       + 'does not sit on the seam.' },
    { q: 'Can I cut at different heights along the same wall?',
      a: 'You can, and it creates a stepped seam that is hard to finish and obvious afterwards. '
       + 'Pick one height for a continuous run.' },
  ],
  related: ['water-damage-categories', 'measure-water-damaged-drywall', 'document-water-damage'],
  download: null,
},

{
  slug: 'measure-water-damaged-drywall',
  audience: 'restoration',
  title: 'Measuring water-damaged drywall for an estimate',
  metaTitle: 'How to Measure Water-Damaged Drywall',
  description:
    'Turning a wet patch into square feet of board and feet of base — the arithmetic, '
    + 'and the numbers that come with it that people forget to claim.',
  keywords: ['measure water damaged drywall', 'water damage square footage',
             'drywall replacement estimate water damage', 'affected area calculation'],
  minutes: 8,
  standfirst:
    'A patch of damage has more numbers in it than a square footage. Most estimates '
    + 'claim one of them.',
  blocks: [
    { h2: 'The affected area itself' },
    { p: 'Three measurements define it: which wall, how far up from the floor, how far along. '
       + 'Everything downstream is arithmetic on those.' },
    { formula: 'affected face = run along the wall × height affected',
      note: 'A wet patch 9 ft along the wall and 18 in up is 9 × 1.5 = 13.5 sq ft of face.' },
    { p: 'If the scope is a flood cut, the area you are replacing is the run times the cut '
       + 'height rather than the run times the water line — which is why both figures have to '
       + 'be recorded.' },

    { h2: 'What comes with it' },
    { p: 'These are the lines that reliably go unclaimed:' },
    { ul: [
        'Base and shoe along the affected run — it is coming off, and it rarely goes back on undamaged.',
        'Insulation in the cavity behind the affected board.',
        'The paint line: the finished wall does not stop at the cut, so there is a repaint area that is larger than the replacement area.',
        'Anything mounted on the affected run that has to come off and go back.',
        'The ceiling, if water came from above rather than below — a different surface and a different line.',
      ] },
    { note: 'The repaint area is the most commonly missed. Replacing 13.5 sq ft of board '
          + 'means finishing a wall, and a wall is not 13.5 sq ft. Whether you claim to a '
          + 'corner, to a break, or the whole wall is a judgement — but claiming the '
          + 'replacement area alone is claiming for half the work.' },

    { h2: 'Multiple patches on one wall' },
    { p: 'Two wet areas on the same wall are two observations, and they should be recorded '
       + 'that way — but if the repair is one continuous strip, the scope is one strip. Record '
       + 'both observations, then state the scope as what you will actually do.' },
    { p: 'This is the kind of thing that is trivially easy on site and genuinely hard three '
       + 'days later at a desk. ScanToBid marks each patch where it is on the wall, keeps them '
       + 'separate as observations, and works out the areas from the wall it already measured.' },

    { h2: 'Why the wall length has to be right' },
    { p: 'Every one of these figures is multiplied by a wall length. A wall that came off a '
       + 'scan and was never checked carries its error into the affected area, the base run, '
       + 'the repaint area and the estimate total — and by the time it reaches the total, '
       + 'nothing on the page says it started as a guess.' },
    { p: 'One tape on one wall running each way, before you price it.' },
  ],
  faq: [
    { q: 'How do you calculate water-damaged drywall square footage?',
      a: 'Multiply the run along the wall by the height affected. If you are flood-cutting, '
       + 'the replacement area is the run times the cut height instead — so record both the '
       + 'observed water line and the cut height.' },
    { q: 'Should the repaint area be bigger than the replacement area?',
      a: 'Almost always. You cannot finish a 13 sq ft patch and leave the rest of the wall, so '
       + 'the paint line runs to a corner, a break, or the full wall. Claiming only the '
       + 'replacement area claims for about half the work.' },
    { q: 'Do you claim baseboard on a water loss?',
      a: 'If it is coming off, yes — and on a wet run it rarely goes back undamaged. It is a '
       + 'linear-feet line alongside the square-feet line, and it is one of the most commonly '
       + 'forgotten items on a water estimate.' },
  ],
  related: ['flood-cut-height', 'document-water-damage', 'drywall-takeoff'],
  download: 'takeoff-sheet',
},

{
  slug: 'adjusters-look-for',
  audience: 'restoration',
  title: 'What an adjuster is actually looking for in your file',
  metaTitle: 'What Adjusters Look For in a Water Damage File',
  description:
    'The questions every claim file has to answer, in the order they get asked — and '
    + 'what a file looks like when it answers them without being chased.',
  keywords: ['what adjusters look for', 'insurance adjuster documentation',
             'water damage claim file', 'restoration claim approval'],
  minutes: 9,
  standfirst:
    'An adjuster is not looking for reasons to deny. They are looking for enough to '
    + 'approve without being second-guessed — and a file that supplies it moves fast.',
  blocks: [
    { h2: 'The five questions, in order' },
    { steps: [
        { h3: 'What was the source?',
          p: 'Coverage often turns on this before anything else. A photograph of the failed '
           + 'component, with enough context to show what it is attached to.' },
        { h3: 'When did it happen, and when was it found?',
          p: 'Two dates, separately. The gap affects category and it affects what could '
           + 'reasonably have been prevented.' },
        { h3: 'What is actually damaged?',
          p: 'Which materials, which rooms, how far. With photographs taken before anything '
           + 'moved, and with measurements rather than adjectives.' },
        { h3: 'How do you know it was wet?',
          p: 'Moisture readings against a dry standard, at identified points, over time.' },
        { h3: 'What are you proposing, and why that?',
          p: 'Scope tied to the damage, with the reasoning visible — especially where the '
           + 'scope exceeds the visible damage, as a flood cut always does.' },
      ] },

    { h2: 'What slows a file down' },
    { ul: [
        'Photographs with no wide shot, so nothing can be located.',
        'A single "area" figure with no indication whether it is floor, wall face or ceiling.',
        'Moisture readings with no dry standard, or with the scale changing partway through.',
        'A scope that exceeds the documented damage with no explanation of why.',
        'Quantities that appear on the estimate but nowhere in the documentation.',
        'Twenty-eight attachments and no document that puts them in order.',
      ] },
    { note: 'Every one of those is a request for information, and every request for '
          + 'information is a week. The cost of thorough documentation is an hour on site; the '
          + 'cost of thin documentation is measured in weeks of float.' },

    { h2: 'One document, in the right order' },
    { p: 'The thing that moves a claim is a single file an adjuster can read start to finish: '
       + 'the loss narrative, the property and the dates, the room with its measurements, each '
       + 'damage with its area and its photographs, the moisture log, and the scope. In that '
       + 'order, because that is the order the questions come in.' },
    { p: 'That is exactly what ScanToBid’s claim document is — assembled from the measurements '
       + 'and marks you took on site, with each figure showing where it came from and each '
       + 'photograph attached to the damage it belongs to rather than to an email.' },
    { shot: 'claim', caption:
      'Damages, their areas, and the readings — one document assembled from what was recorded '
      + 'on site.' },
    { h2: 'The difference between evidence and assertion' },
    { p: 'Almost every weak claim file is full of assertions. "The wall was wet." "Extensive '
       + 'damage." "Full replacement required." Every one of those is a statement the reader '
       + 'has to take on trust, from somebody with a financial interest in it.' },
    { table: {
        head: ['Assertion', 'The same thing as evidence'],
        rows: [
          ['“The wall was wet.”',
           '“North wall read 18% on 14 March against a dry standard of 9% on the same wall type.”'],
          ['“Extensive damage.”',
           '“Affected 9 ft along the north wall to 18 in, and 6 ft along the east wall to 14 in.”'],
          ['“Full replacement required.”',
           '“Cut at 4 ft across both runs; water observed to 26 in and outlets at 14 in.”'],
          ['“Dried on 22 March.”',
           '“Readings fell from 18% to 9% between 14 and 22 March at the same four points.”'],
        ] } },
    { p: 'The right-hand column is not more work. It is the same information written down at '
       + 'the time instead of summarised afterwards.' },

    { h2: 'Supplements, and how to avoid needing one' },
    { p: 'Most supplements exist because something was found later that was not documented '
       + 'earlier — wet insulation behind board that came off on day three, a second room that '
       + 'turned out to be affected, a subfloor nobody read.' },
    { p: 'The two habits that reduce them are boring and effective: read more points than you '
       + 'think you need on the first visit, and photograph everything at the moment it becomes '
       + 'visible. A photograph of wet insulation taken as the board came off is worth more '
       + 'than any amount of explanation later.' },
  ],
  faq: [
    { q: 'What makes an insurance adjuster question an estimate?',
      a: 'Numbers with nothing behind them. A scope that exceeds the documented damage with no '
       + 'reason given, an area figure that does not say whether it is floor or wall, or '
       + 'quantities on the estimate that appear nowhere in the documentation.' },
    { q: 'How much documentation is too much?',
      a: 'There is no such thing as too much evidence, but there is very much such a thing as '
       + 'too little order. Twenty-eight attachments with no document organising them is worse '
       + 'than eight photographs inside one file that reads start to finish.' },
    { q: 'Does better documentation actually get claims paid faster?',
      a: 'Every gap is a request for information and every request for information is delay. '
       + 'A file that answers the five standard questions without being asked removes the '
       + 'reasons to come back to you.' },
    { q: 'What is the difference between evidence and assertion in a claim?',
      a: 'An assertion is “the wall was wet”. Evidence is “north wall read 18% on 14 March '
       + 'against a dry standard of 9% on the same wall type”. Same information, written down '
       + 'at the time rather than summarised afterwards.' },
    { q: 'How do I avoid having to file a supplement?',
      a: 'Read more points than you think you need on the first visit, and photograph anything '
       + 'the moment it becomes visible — wet insulation as the board comes off, a subfloor as '
       + 'it is exposed. Most supplements are things found later that were not documented '
       + 'earlier.' },
  ],
  related: ['loss-description', 'document-water-damage', 'moisture-readings-log'],
  download: 'damage-log',
},

];
