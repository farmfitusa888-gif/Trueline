/**
 * Guides for homeowners.
 *
 * They will never subscribe. They search in enormous numbers, they link to
 * things that helped them, and — the part that matters commercially — a
 * homeowner who has read what a good estimate contains is a homeowner who is
 * easier for a careful contractor to sell to.
 *
 * Written to be genuinely useful to somebody about to spend a lot of money,
 * and written without ever telling them what a job costs. Nobody here knows
 * their market, their house or their year.
 */
export const HOMEOWNER = [

{
  slug: 'estimate-should-include',
  audience: 'homeowner',
  title: 'What a contractor’s estimate should include',
  metaTitle: 'What Should a Contractor’s Estimate Include?',
  description:
    'The eleven things to look for before you sign anything, what each one protects '
    + 'you from, and the single most valuable paragraph in the document.',
  keywords: ['what should a contractor estimate include', 'contractor estimate checklist',
             'reviewing a contractor quote', 'what to look for in a construction estimate'],
  minutes: 8,
  standfirst:
    'You are not really being asked to approve a price. You are being asked to agree '
    + 'a scope — and almost every dispute afterwards is about something the estimate '
    + 'did not say.',
  blocks: [
    { h2: 'The checklist' },
    { ul: [
        '<strong>Who they are</strong> — business name, address, phone, licence number and insurance. In most states you can check a licence online in about thirty seconds. Do it.',
        '<strong>Your name and the address of the work</strong> — these are sometimes different, and every later document hangs off this line.',
        '<strong>A date, and how long the price holds.</strong> Materials move. An estimate with no expiry is unusual and worth asking about.',
        '<strong>The scope, in sentences you understand.</strong> If you cannot read it, do not sign it.',
        '<strong>Quantities.</strong> How much of each thing. This is what lets you compare two quotes at all.',
        '<strong>The price, broken out.</strong> One number with nothing behind it tells you nothing about whether it is reasonable.',
        '<strong>What is NOT included.</strong> The most valuable paragraph on the page.',
        '<strong>Allowances</strong> — where you pick the material later, what has been allowed, and what happens if you pick something dearer.',
        '<strong>Payment terms</strong> — deposit, stages, and what triggers each one.',
        '<strong>How changes get handled</strong> — and the right answer is: quoted and signed before the work starts.',
        '<strong>Somewhere to sign.</strong>',
      ] },

    { h2: 'Why the exclusions matter more than the price' },
    { p: 'A shorter quote is not a better quote. Very often it is the same job with fewer '
       + 'things written down — and everything not written down becomes a conversation later, '
       + 'while your kitchen is in pieces.' },
    { p: 'When you compare two estimates, read the exclusions first. The one that says '
       + '"permits, disposal and anything found behind the wall are not included" is being '
       + 'straight with you. The one that says nothing has the same exclusions; it just has '
       + 'not told you yet.' },
    { note: 'The lowest number frequently belongs to the least complete document. That is not '
          + 'always dishonesty — it is often just less careful — but it is the same outcome '
          + 'for you.' },

    { h2: 'Quantities are how you compare two quotes' },
    { p: 'Two estimates for "the kitchen" cannot be compared. Two estimates that both say 416 '
       + 'square feet of wall face, 168 of ceiling, 52 feet of base, one door and one window '
       + 'can be — and if their quantities differ, one of them has measured something the '
       + 'other has not, which is worth asking about before you look at either price.' },

    { h2: 'A fair question to ask' },
    { p: 'Ask whether the quantities were measured or estimated. It is a completely normal '
       + 'question, it is not rude, and the answer tells you a lot about how the job will be '
       + 'run. A contractor who says "those came off a scan, I will confirm them with a tape '
       + 'before we start" is being more careful than one who says "they are accurate".' },
    { p: 'Some tools now put this on the document itself. ScanToBid prints the word '
       + '<strong>SCANNED</strong> across a drawing until somebody has actually put a tape on '
       + 'the walls — which is unusual, and worth knowing exists so you can ask for it.' },
    { shot: 'plan', caption:
      'A drawing that says, on its face, that the numbers on it came from a scanner rather '
      + 'than a tape.' },
  ],
  faq: [
    { q: 'Should a contractor’s estimate be itemised?',
      a: 'Detailed enough that you can see where the number came from — quantities and a real '
       + 'exclusions list. A single figure with nothing behind it gives you no way to compare '
       + 'it to anything.' },
    { q: 'Is a contractor estimate legally binding?',
      a: 'It depends on what the document says and on your state. A document headed "estimate" '
       + 'that says the price may change is treated differently from a signed fixed quote. '
       + 'Read the words at the top and the payment terms at the bottom.' },
    { q: 'What is the most important part of an estimate?',
      a: 'The exclusions. Everything not written down becomes a conversation later, from a '
       + 'weaker position, while your house is in pieces.' },
    { q: 'Should I pay a deposit?',
      a: 'A deposit is normal, especially where material has to be ordered. What matters is '
       + 'that the amount and what triggers each later payment are written down, and that the '
       + 'stages are tied to work rather than to dates.' },
  ],
  related: ['read-a-contractor-quote', 'estimate-red-flags', 'kitchen-remodel-cost-drivers'],
  download: 'estimate-form',
},

{
  slug: 'read-a-contractor-quote',
  audience: 'homeowner',
  title: 'How to read a contractor’s quote',
  metaTitle: 'How to Read a Contractor’s Quote Properly',
  description:
    'What the words mean, what the numbers are made of, and the questions that get '
    + 'you a better answer than "is that your best price?"',
  keywords: ['how to read a contractor quote', 'understanding a construction quote',
             'contractor quote explained', 'compare contractor quotes'],
  minutes: 9,
  standfirst:
    'Three quotes for the same job will differ by more than you expect, and almost '
    + 'never for the reason you assume.',
  blocks: [
    { h2: 'The words at the top mean different things' },
    { table: {
        head: ['Word', 'What it usually means'],
        rows: [
          ['Estimate', 'A considered figure that may move'],
          ['Quote', 'A price they intend to honour'],
          ['Bid', 'A price offered in competition'],
          ['Proposal', 'A scope offered for your signature, with a price on it'],
        ] } },
    { p: 'These are used loosely, so read the payment terms and any line about the price '
       + 'changing rather than trusting the heading.' },

    { h2: 'Why three quotes differ' },
    { ul: [
        '<strong>Different scope.</strong> The commonest reason by a wide margin. One includes painting; one does not. One is taking the soffit out.',
        '<strong>Different quantities.</strong> One measured; one paced it out. If the square footages differ, someone is wrong.',
        '<strong>Different materials.</strong> Same word, very different product.',
        '<strong>Different exclusions.</strong> Which is the same as different scope, written down honestly.',
        '<strong>Different rates.</strong> The last thing to look at, not the first.',
      ] },
    { note: 'If two quotes for the same room state different square footages, that is the '
          + 'question to ask before any other. One of them has measured something the other '
          + 'has not — or one of them has not measured at all.' },

    { h2: 'Better questions than "is that your best price?"' },
    { steps: [
        { h3: '"What is not included?"',
          p: 'You will learn more from this than from anything else you ask.' },
        { h3: '"Were these quantities measured or estimated?"',
          p: 'Completely normal to ask. The answer tells you how the job will be run.' },
        { h3: '"What happens if you find something behind the wall?"',
          p: 'You want to hear: it stops, it gets photographed, it gets priced, you sign, then '
           + 'it happens.' },
        { h3: '"What are the payment stages tied to?"',
          p: 'Work completed, not dates on a calendar.' },
        { h3: '"Who is actually doing the work?"',
          p: 'Their crew, or subcontractors, and either answer is fine — you just want to know.' },
      ] },

    { h2: 'What a good quote feels like' },
    { p: 'It is longer than you expected, it says several things it is not doing, the '
       + 'quantities are on it, and nothing in it is a surprise later. That is the whole test.' },
    { p: 'A quote that is one line and a number may still come from a good contractor. It just '
       + 'gives you nothing to hold, and nothing to compare.' },
    { h2: 'Lining three quotes up side by side' },
    { p: 'The useful exercise is not comparing totals. It is building a small table of what '
       + 'each one actually says, which usually explains the difference before you get to the '
       + 'money.' },
    { table: {
        head: ['Ask of each quote', 'What a difference tells you'],
        rows: [
          ['What are the quantities?', 'Different square footages mean somebody measured and somebody did not.'],
          ['Is demolition included?', 'Often the single biggest silent difference.'],
          ['Is disposal included?', 'A skip is a real cost and it is frequently excluded.'],
          ['Are permits included?', 'Varies enormously by area and by contractor.'],
          ['Is painting included?', 'The scope frequently stops at finished board.'],
          ['What material grade?', 'Same word, very different product and price.'],
          ['What is explicitly excluded?', 'The most informative line in the whole document.'],
        ] } },
    { p: 'Fill that in for three quotes and the cheapest one usually stops being cheapest.' },

    { h2: 'Questions about the people, not the paper' },
    { ul: [
        'Who will be on site day to day, and can I contact them?',
        'How many other jobs will be running at the same time?',
        'What is the start date, and what does it depend on?',
        'What happens if materials are delayed?',
        'Can I speak to somebody whose kitchen you did last year?',
      ] },
    { p: 'None of these is on the quote and all of them affect how the job feels. A contractor '
       + 'who answers them easily has run a lot of jobs.' },
  ],
  faq: [
    { q: 'Why are contractor quotes so different from each other?',
      a: 'Usually scope rather than price — one includes something another does not. The next '
       + 'commonest reason is quantities: if two quotes for the same room state different '
       + 'square footages, ask about that before you look at either total.' },
    { q: 'Should I always take the lowest quote?',
      a: 'The lowest number frequently belongs to the least complete document. Compare the '
       + 'exclusions and the quantities first; if those match and one price is lower, then you '
       + 'are comparing prices.' },
    { q: 'Is it rude to ask whether the measurements are real?',
      a: 'Not at all, and a careful contractor will have a good answer ready. "Those came off '
       + 'a scan and I will confirm them with a tape before we start" is a better answer than '
       + '"they are accurate".' },
    { q: 'How do I compare three contractor quotes fairly?',
      a: 'Build a small table: quantities, demolition, disposal, permits, painting, material '
       + 'grade and exclusions. Fill it in for each quote before you look at any total — the '
       + 'cheapest one very often stops being cheapest once the table is complete.' },
    { q: 'What should I ask a contractor that is not on the quote?',
      a: 'Who is on site day to day, how many other jobs run at the same time, what the start '
       + 'date depends on, what happens if materials are delayed, and whether you can speak to '
       + 'a recent client. None of it is on the paper and all of it affects the job.' },
  ],
  related: ['estimate-should-include', 'estimate-red-flags', 'kitchen-remodel-cost-drivers'],
  download: null,
},

{
  slug: 'kitchen-remodel-cost-drivers',
  audience: 'homeowner',
  title: 'What actually drives the cost of a kitchen remodel',
  metaTitle: 'What Really Drives Kitchen Remodel Cost',
  description:
    'Why a per-square-foot figure is useless for kitchens, the five decisions that '
    + 'move the number most, and what to ask before you commit to any of them.',
  keywords: ['kitchen remodel cost', 'what drives kitchen renovation cost',
             'kitchen remodel budget', 'kitchen renovation price factors'],
  minutes: 9,
  standfirst:
    'Two kitchens the same size can differ by a factor of four, and the room’s floor '
    + 'area is close to the least important thing about it.',
  blocks: [
    { h2: 'Why nobody can tell you a per-square-foot number' },
    { p: 'Almost nothing expensive in a kitchen scales with floor area. Cabinets are priced by '
       + 'the run along the wall. Counters are the area of the top. Appliances are a count. '
       + 'Plumbing and electrical are about how far things move, not how big the room is.' },
    { p: 'A square-foot figure prices the flooring, which is one of the cheaper lines in the '
       + 'room. It is a comforting number and it will not survive contact with a real quote.' },

    { h2: 'The five decisions that actually move it' },
    { steps: [
        { h3: 'Does anything move?',
          p: 'Keeping the sink, the stove and the fridge where they are is the single biggest '
           + 'saving available to you. Moving a sink means moving a drain, and a drain has to '
           + 'fall — which is why it is expensive and why the answer sometimes involves the '
           + 'floor coming up.' },
        { h3: 'Cabinets: stock, semi-custom or custom',
          p: 'This is usually the largest single line, and the range within it is enormous. '
           + 'Same layout, same room, three very different numbers.' },
        { h3: 'Counter material',
          p: 'Priced by the area of the top, plus cut-outs and edge profiles as separate '
           + 'items. Ask what the edge and the sink cut-out cost — they are not always in the '
           + 'headline square-foot figure.' },
        { h3: 'Is anything structural?',
          p: 'Removing a wall means finding out whether it holds the house up. A beam and its '
           + 'supports is a different order of work from a partition.' },
        { h3: 'What is behind the walls',
          p: 'Wiring that is not to code, a stack in an inconvenient place, rot under a long-'
           + 'leaking sink. Nobody knows until it is open, which is why a good quote excludes '
           + 'it explicitly rather than pretending.' },
      ] },

    { h2: 'How to read a kitchen quote against these' },
    { p: 'Ask which of the five your quote assumes. A number that assumes nothing moves and '
       + 'nothing is structural is a fine number — as long as you both know that is what it '
       + 'assumes, and as long as the document says so.' },
    { note: 'A quote that excludes "anything found behind existing finishes" is not hedging. '
          + 'It is the only honest position anybody can take about a wall nobody has opened, '
          + 'and it is much better than a padded number you cannot see inside.' },

    { h2: 'One thing worth insisting on' },
    { p: 'Get the quantities. Not because you will check them, but because a quote with '
       + 'quantities on it can be compared with another quote, and a quote without them cannot '
       + 'be compared with anything.' },
    { h2: 'Where the money usually goes' },
    { p: 'Without quoting figures — which depend entirely on your market, your year and your '
       + 'choices — the ORDER is fairly consistent across kitchens:' },

    { ul: [
        '<strong>Cabinets</strong>, almost always the largest single line, with an enormous range inside it.',
        '<strong>Labour</strong>, across every trade, which is why moving things is so expensive.',
        '<strong>Counters</strong>, driven by material and by the number of cut-outs and edges.',
        '<strong>Appliances</strong>, which you often supply and which have no ceiling.',
        '<strong>Flooring</strong>, usually smaller than people expect.',
        '<strong>Everything else</strong> — lighting, plumbing fixtures, paint, hardware — which adds up faster than any single item suggests.',
      ] },
    { p: 'The reason a per-square-foot figure fails is visible in that list: only one item on '
       + 'it scales with the size of the room.' },

    { h2: 'The decisions that cost nothing to make early' },
    { steps: [
        { h3: 'Keep the plumbing where it is',
          p: 'If the layout works, leaving the sink alone is the largest saving available and '
           + 'it costs you nothing but a preference.' },
        { h3: 'Decide the cabinet tier before anything else',
          p: 'It sets the scale of the whole project, and changing your mind later re-prices '
           + 'everything around it.' },
        { h3: 'Ask what is behind the walls before demolition',
          p: 'Sometimes the answer is knowable — an electrician can look at a panel, a plumber '
           + 'can look at a stack. Knowing early turns a surprise into a plan.' },
        { h3: 'Agree the change process in writing',
          p: 'Before there is a change to argue about.' },
      ] },
  ],
  faq: [
    { q: 'How much does a kitchen remodel cost per square foot?',
      a: 'This is the wrong unit and any figure you are given against it will mislead you. '
       + 'Cabinets are priced by the run, counters by the top area, appliances by the count, '
       + 'and plumbing by how far things move. Floor area prices the flooring.' },
    { q: 'What is the most expensive part of a kitchen remodel?',
      a: 'Usually the cabinets, with the biggest single swing coming from whether the sink, '
       + 'stove and fridge stay where they are. Moving a sink means moving a drain, and drains '
       + 'have to fall.' },
    { q: 'Why do contractors exclude "anything behind the walls"?',
      a: 'Because nobody can see behind a wall until it is open, and the alternative is a '
       + 'padded number you cannot inspect. An explicit exclusion is the honest version, and '
       + 'it should come with a process: it stops, it is photographed, it is priced, you sign.' },
    { q: 'What is the order of cost in a kitchen remodel?',
      a: 'Usually cabinets first, then labour across all trades, then counters, appliances, '
       + 'flooring, and everything else. Only the flooring scales with the size of the room, '
       + 'which is why per-square-foot figures mislead.' },
    { q: 'What is the cheapest way to reduce a kitchen quote?',
      a: 'Keep the plumbing where it is, and decide the cabinet tier early. Those two '
       + 'decisions cost nothing to make and they move the number more than anything else '
       + 'available to you.' },
  ],
  related: ['estimate-should-include', 'read-a-contractor-quote', 'price-a-kitchen-remodel'],
  download: null,
},

{
  slug: 'estimate-red-flags',
  audience: 'homeowner',
  title: 'Seven red flags in a contractor’s estimate',
  metaTitle: 'Red Flags in a Contractor’s Estimate',
  description:
    'What to look for before you sign — and why the biggest warning sign is usually '
    + 'something missing rather than something written.',
  keywords: ['contractor red flags', 'contractor estimate warning signs',
             'avoid contractor scams', 'bad contractor quote'],
  minutes: 7,
  standfirst:
    'Most of these are not dishonesty. They are carelessness — which produces the '
    + 'same experience for you, over a longer period.',
  blocks: [
    { h2: 'The seven' },
    { steps: [
        { h3: 'No licence or insurance number on the document',
          p: 'In most states you can check a licence online in under a minute. A contractor '
           + 'who does not put the number on their own paperwork has made that harder for no '
           + 'good reason.' },
        { h3: 'No exclusions',
          p: 'Every job has things that are not included. A document that lists none has the '
           + 'same exclusions as everybody else’s — it just has not told you what they are.' },
        { h3: 'No quantities',
          p: 'Without them you cannot compare this quote to any other, and neither of you has '
           + 'anything to point at when the scope changes.' },
        { h3: 'A large deposit with no material behind it',
          p: 'A deposit to order cabinets is ordinary. A large deposit before anything has '
           + 'been ordered or scheduled is worth a direct question.' },
        { h3: 'Payment stages tied to dates rather than work',
          p: '"50% on 1 April" is not a milestone. "50% on completion of rough-in" is.' },
        { h3: 'Pressure, or a price that expires today',
          p: 'Prices do expire, and thirty days is normal. Twenty-four hours is a sales '
           + 'technique.' },
        { h3: 'No process for changes',
          p: 'You want a sentence saying extra work is quoted and signed before it starts. '
           + 'Without it, you will find out about extra work when the bill arrives.' },
      ] },

    { h2: 'The one that is hardest to spot' },
    { p: 'Numbers nobody measured, presented as though somebody had. There is usually nothing '
       + 'on the page to tell you — a paced-out figure and a taped one look identical once '
       + 'they are typed.' },
    { p: 'The only reliable move is to ask. "Were these measured or estimated?" is a normal, '
       + 'polite question, and a careful contractor has a ready answer. The uncomfortable '
       + 'answer is not "estimated" — it is a contractor who cannot say which.' },
    { note: 'Some tools now put this on the document. ScanToBid prints SCANNED across a drawing '
          + 'until a tape has actually been on the walls, so the honest answer is on the page '
          + 'rather than in a conversation. It is worth knowing that exists.' },

    { h2: 'What is not a red flag' },
    { ul: [
        'A quote that is longer than the others. That is usually the careful one.',
        'A price higher than the lowest. Compare scope before you compare totals.',
        'Being told the job cannot be priced until a wall is opened. That is honesty.',
        'A contractor who charges for a detailed measured takeoff. On a large job that is a day of work.',
      ] },
    { h2: 'Checking a licence, in about a minute' },
    { p: 'Most US states run a public licence lookup. Search for your state plus "contractor '
       + 'licence lookup" and you will usually find an official database where a number, a '
       + 'name or a business will tell you whether a licence is current, what it covers, and '
       + 'sometimes whether there have been complaints.' },
    { p: 'It costs a minute, it is not an accusation, and a legitimate contractor expects it. '
       + 'Requirements vary a great deal by state and by trade, so check what your own state '
       + 'actually requires rather than assuming.' },

    { h2: 'Insurance is two different things' },
    { table: {
        head: ['Cover', 'What it protects'],
        rows: [
          ['General liability', 'Damage to your property caused by the work'],
          ['Workers’ compensation', 'Injury to their workers on your property'],
        ] } },
    { p: 'These are separate policies and a contractor may carry one and not the other. Ask '
       + 'for a certificate of insurance rather than a number on a letterhead — a certificate '
       + 'comes from the insurer and states the dates the cover runs.' },

    { h2: 'What to do if something is wrong' },
    { ul: [
        'Ask, directly and early. Most of these have ordinary explanations and the answer tells you a lot.',
        'Get every answer in writing, added to the estimate rather than sent in a message.',
        'Do not pay a deposit until the paperwork is right. It is the only leverage that exists.',
        'If a contractor is annoyed by any of these questions, that is itself the answer.',
      ] },
  ],
  faq: [
    { q: 'What are the warning signs of a bad contractor?',
      a: 'On the paperwork: no licence or insurance number, no exclusions, no quantities, a '
       + 'large deposit with nothing ordered, payment stages tied to dates rather than work, '
       + 'pressure to sign today, and no written process for changes.' },
    { q: 'How much deposit is normal?',
      a: 'It varies by job and by state, and some states cap it. What matters more than the '
       + 'percentage is what it is for — a deposit against material that is being ordered is '
       + 'ordinary; a large one before anything is ordered or scheduled deserves a question.' },
    { q: 'Should I be worried if a quote is much higher than the others?',
      a: 'Compare the scope and the quantities first. Very often the higher quote includes '
       + 'something the others left out, and the difference disappears once you line them up.' },
    { q: 'How do I check a contractor’s licence?',
      a: 'Most US states run a public lookup — search your state plus "contractor licence '
       + 'lookup". You can usually check whether a licence is current, what it covers, and '
       + 'sometimes whether complaints have been filed. Requirements vary by state and trade, '
       + 'so check what yours actually requires.' },
    { q: 'What insurance should a contractor carry?',
      a: 'General liability, which covers damage to your property from the work, and workers’ '
       + 'compensation, which covers injury to their workers on your property. They are '
       + 'separate policies. Ask for a certificate of insurance from the insurer rather than a '
       + 'number on a letterhead.' },
  ],
  related: ['estimate-should-include', 'read-a-contractor-quote', 'kitchen-remodel-cost-drivers'],
  download: null,
},

];
