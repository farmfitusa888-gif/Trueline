/**
 * Comparison pages. The smallest audience and the highest intent in the plan —
 * somebody typing "magicplan alternative" is a week from paying somebody.
 *
 * ## The rule these are written under
 *
 * **No invented facts about anybody else's product.** No prices, no feature
 * lists, no accuracy figures for software this project has not run. Competitor
 * pricing moves constantly and a number frozen into a file here would be wrong
 * within months and dishonest immediately.
 *
 * So these compare *approaches* rather than scoring rivals: what the categories
 * of tool are, what each is structurally good and bad at, and which questions
 * to ask of any of them. That is more useful to the reader and it is the only
 * version that stays true.
 */
export const COMPARE = [

{
  slug: 'magicplan-alternative',
  audience: 'compare',
  title: 'Looking for a magicplan alternative: what to compare',
  metaTitle: 'magicplan Alternative: What to Actually Compare',
  description:
    'The six questions worth asking of any room-measuring and estimating app, and '
    + 'why "does it flag a guess" is the one most people never ask.',
  keywords: ['magicplan alternative', 'alternative to magicplan', 'room measuring app comparison',
             'floor plan app for contractors'],
  minutes: 9,
  standfirst:
    'Most comparisons of these apps list features. The features are broadly the same. '
    + 'What differs is what happens when the phone gets a wall wrong.',
  blocks: [
    { h2: 'Six questions, in order of how much they will cost you' },
    { steps: [
        { h3: 'Does it tell you which numbers are measured?',
          p: 'Every one of these tools produces a number for a wall. Almost none of them '
           + 'distinguishes between a wall the sensor guessed at and a wall somebody put a '
           + 'tape on — and that difference is the one that ends up on a contract.' },
        { h3: 'Where does your work live?',
          p: 'Hosted service, your own cloud storage, or the device. This decides what happens '
           + 'when you stop paying, and whether a client’s address sits on somebody else’s '
           + 'server.' },
        { h3: 'What does it cost per project?',
          p: 'Per-scan, per-project and per-export pricing all look small and all scale with '
           + 'your busiest month. A flat seat price is easier to plan against.' },
        { h3: 'Does the estimate come out of the same measurements?',
          p: 'If the takeoff is a separate step where numbers get re-typed, the two documents '
           + 'will eventually disagree, and it will be in front of a client.' },
        { h3: 'What happens with no signal?',
          p: 'Basements. Half the job sites in this trade have no bars, and a tool that needs '
           + 'a round trip to a server is a tool that stops in exactly the room you needed it.' },
        { h3: 'Can you get your data out?',
          p: 'PDF, CSV, CAD, ESX. And can the client open what you send without an account?' },
      ] },

    { h2: 'Where ScanToBid sits, plainly' },
    { p: 'It is built around the first question. Every length carries how it was arrived at — '
       + 'scanned by the phone, drawn on a grid, or measured with a tape — and that travels '
       + 'onto the drawing, the takeoff, the proposal and the claim. Until a tape has been on '
       + 'one wall running each way, the sheet says <strong>SCANNED</strong> across its face '
       + 'where a client reads it.' },
    { p: 'On the others: there is no ScanToBid server. Rooms are folders on your phone, backed '
       + 'up to your own iCloud, and the whole app works with no signal. Measuring, the '
       + 'drawing and the 3D view are free; the takeoff, the pricing, the proposal and the '
       + 'claim documents are the subscription.' },
    { note: 'What it is not: a hosted platform with a client portal, a team of users, or a '
          + 'library of national cost data. Prices come from your own rate book, and if you '
          + 'want a shared workspace for six estimators this is the wrong tool.' },

    { h2: 'Questions to ask whichever you pick' },
    { ul: [
        'What is the total for a year, including any per-project or per-export charges?',
        'If I cancel, can I still open the jobs I have already done?',
        'Does a client need an account to open what I send them?',
        'What exactly happens on a phone with no LiDAR?',
        'Does the app ever tell me a number is unreliable?',
      ] },
    { p: 'Pricing and feature lists change constantly, so check them against the vendor rather '
       + 'than against any comparison page — including this one.' },
  ],
  faq: [
    { q: 'What should I look for in a room measuring app?',
      a: 'Beyond the obvious: whether it distinguishes a scanned number from a measured one, '
       + 'where your data lives, whether the estimate comes out of the same measurements as '
       + 'the drawing, and whether it works with no signal. Feature lists across these tools '
       + 'are broadly similar; those four are where they genuinely differ.' },
    { q: 'Is there a free alternative to magicplan?',
      a: 'Several tools including ScanToBid have a free tier — usually the measuring and the '
       + 'drawing, with estimating and documents paid. Compare the total annual cost including '
       + 'any per-project or per-export fees rather than the headline monthly figure.' },
    { q: 'Do these apps need internet?',
      a: 'It varies, and it is worth asking directly. Anything that renders plans or stores '
       + 'projects server-side needs a connection at some point, which matters more than it '
       + 'sounds when half your job sites are basements.' },
  ],
  related: ['best-room-measuring-apps', 'do-i-need-lidar-iphone', 'lidar-room-scanning'],
  download: null,
},

{
  slug: 'best-room-measuring-apps',
  audience: 'compare',
  title: 'Room measuring apps for contractors: the four kinds',
  metaTitle: 'Room Measuring Apps for Contractors: 4 Kinds',
  description:
    'LiDAR scanners, photogrammetry, AR point-to-point and manual sketch tools — what '
    + 'each is structurally good at, and which one belongs on your phone.',
  keywords: ['best room measuring app', 'room measuring app for contractors',
             'floor plan app', 'construction measuring app'],
  minutes: 10,
  standfirst:
    'Every app in this category is one of four things underneath. Knowing which one '
    + 'you are holding tells you where it will let you down.',
  blocks: [
    { h2: 'The four kinds' },
    { table: {
        head: ['Kind', 'How it works', 'Good at', 'Fails at'],
        rows: [
          ['LiDAR scan', 'A depth sensor plus software that decides what is a wall',
           'Whole rooms in ninety seconds, openings, not forgetting the closet',
           'Mirrors, glass, dark surfaces, clutter against walls'],
          ['Photogrammetry', 'Many photographs reconstructed into a model',
           'Detailed 3D of objects and exteriors',
           'Slow, needs good light, and heavy to process'],
          ['AR point-to-point', 'Tap two points through the camera, phone measures between',
           'Any phone, one-off dimensions, no LiDAR required',
           'Accumulating drift, and it needs a camera and light'],
          ['Manual sketch', 'You draw it and type the numbers',
           'Every number measured, any shape, works in the dark',
           'Slow, and only as good as your tape work'],
        ] } },
    { p: 'Most serious tools are a LiDAR scanner with one of the others as a fallback. The '
       + 'question worth asking is how good the fallback is, because that is what you use on '
       + 'the job where the scan will not behave.' },

    { h2: 'What none of them do by themselves' },
    { p: 'Tell you which is which afterwards. A room measured three different ways produces '
       + 'one plan, and by the time it is a PDF in an email there is usually nothing on the '
       + 'page saying that the north wall was scanned, the south wall was taped, and the '
       + 'closet was drawn from memory.' },
    { p: 'That is the gap ScanToBid was built into. Provenance travels with each length all '
       + 'the way to the client’s document, and the app will not call a room measured until a '
       + 'tape has been on one wall running each way.' },
    { shot: 'grid', caption:
      'The fallback that needs no camera at all: tap the corners onto a grid. It says DRAWN '
      + 'rather than measured, because it is.' },

    { h2: 'Choosing between them' },
    { ul: [
        'Doing whole rooms, fast, on a Pro iPhone → LiDAR, with a manual fallback you have actually tried.',
        'No LiDAR on your phone → AR point-to-point, or a grid you tap corners onto.',
        'A room you cannot get back into → manual sketch from the numbers you already have.',
        'Exteriors and objects rather than rooms → photogrammetry, which is a different job.',
      ] },
    { p: 'Whichever you pick, the discipline is the same and it is not about the app: put a '
       + 'tape on one wall running each way before anything gets priced.' },
    { h2: 'Six questions to ask before you subscribe' },
    { steps: [
        { h3: 'What is the total for a year?',
          p: 'Including anything charged per project, per scan or per export. Those look small '
           + 'and they scale with your busiest month, which is exactly when you cannot switch.' },
        { h3: 'If I cancel, can I still open old jobs?',
          p: 'On a hosted service the honest answer is often no. Ask directly, and ask what '
           + 'export you get on the way out.' },
        { h3: 'Does a client need an account to open what I send?',
          p: 'If the answer is yes, you are asking a homeowner to sign up to something in '
           + 'order to read their own quote.' },
        { h3: 'What happens on a phone with no LiDAR?',
          p: 'Half the answer to this is "it does not work". Try the fallback before you need '
           + 'it, because you will need it on the job where the scan misbehaves.' },
        { h3: 'Does it work with no signal?',
          p: 'Basements, new builds with no power, rural jobs. Anything that renders or stores '
           + 'server-side stops in exactly the room you needed it in.' },
        { h3: 'Does it ever tell me a number is unreliable?',
          p: 'Almost none of them do, and it is the difference between a tool that helps you '
           + 'estimate and a tool that helps you be confidently wrong.' },
      ] },

    { h2: 'What the free tiers usually mean' },
    { p: 'Free tiers in this category are almost always the same shape: measuring and viewing '
       + 'are free, and the things that turn a measurement into money are paid. That is a '
       + 'reasonable split — the measuring is the part that gets you to try it, and the '
       + 'estimating is the part that saves you a morning.' },
    { p: 'What varies is where the line sits. Some put the export behind the paywall, some the '
       + 'plan itself, some the number of projects. ScanToBid puts measuring, the drawing and '
       + 'the 3D view on the free side and keeps them there; the takeoff, the pricing, the '
       + 'proposal and the claim documents are the subscription.' },
  ],
  faq: [
    { q: 'What is the best app for measuring a room?',
      a: 'It depends on your phone and your job. On a Pro iPhone a LiDAR scanner is the '
       + 'fastest way to get a whole room including its openings; without LiDAR you want AR '
       + 'point-to-point or a grid you tap corners onto. The more useful question is how good '
       + 'the app’s fallback is, because that is what you will use on the difficult job.' },
    { q: 'Are room scanning apps accurate enough for construction?',
      a: 'For shape, yes — they will get the outline and the openings, which is most of the '
       + 'work. For numbers on a contract, treat a scan as a shape to check rather than a '
       + 'measurement to price off, and put a tape on one wall running each way.' },
    { q: 'Do I need a Pro iPhone?',
      a: 'Only for LiDAR scanning. Everything else — AR point-to-point, tapping corners onto '
       + 'a grid, the takeoff, the pricing and the documents — works on any iPhone.' },
    { q: 'What should I ask before subscribing to a measuring app?',
      a: 'The total annual cost including any per-project fees; whether you can still open old '
       + 'jobs if you cancel; whether a client needs an account to open what you send; what '
       + 'happens on a phone with no LiDAR; and whether it works with no signal.' },
    { q: 'Are the free tiers of these apps usable?',
      a: 'Usually for measuring and viewing, which is the point of them. What differs is where '
       + 'each one draws the line — some paywall the export, some the plan, some the number of '
       + 'projects. Check that before you build a workflow on the free tier.' },
  ],
  related: ['magicplan-alternative', 'do-i-need-lidar-iphone', 'laser-measure-vs-phone-scan'],
  download: null,
},

{
  slug: 'do-i-need-lidar-iphone',
  audience: 'compare',
  title: 'Do you need a LiDAR iPhone to measure rooms?',
  metaTitle: 'Do You Need a LiDAR iPhone to Measure Rooms?',
  description:
    'Which iPhones have the sensor, what you lose without it, and the two ways to '
    + 'measure a room properly on a phone that does not have one.',
  keywords: ['do I need lidar iphone', 'which iphones have lidar', 'measure room without lidar',
             'iphone lidar models'],
  minutes: 7,
  standfirst:
    'LiDAR buys you speed, not accuracy. Without it you can still measure every room '
    + 'you will ever quote — it just takes longer, and every number is one you took.',
  blocks: [
    { h2: 'Which iPhones have it' },
    { p: 'The depth sensor arrived on the iPhone 12 Pro and has been on the Pro and Pro Max '
       + 'models since, along with the iPad Pro from 2020. Standard and Plus iPhones do not '
       + 'have it.' },
    { p: 'Check before buying a phone for this: the sensor is a Pro-line feature and it has '
       + 'stayed that way across generations, but Apple’s line-up changes and the safest check '
       + 'is the model’s own spec page.' },

    { h2: 'What you actually lose without it' },
    { table: {
        head: ['With LiDAR', 'Without'],
        rows: [
          ['Whole room in about ninety seconds', 'A few minutes of tapping corners'],
          ['Doors and windows found automatically', 'You add them yourself'],
          ['Furniture and clutter picked up', 'Not captured'],
          ['A 3D model of the space', 'A plan, from the corners you placed'],
          ['Every length starts as a guess to be checked', 'Every length starts as something you placed'],
        ] } },
    { note: 'That last row cuts the other way from how people expect. A room walked corner by '
          + 'corner, or tapped onto a grid from tape readings, has no sensor guesswork in it at '
          + 'all — it is slower and, in the sense that matters, more honest.' },

    { h2: 'The two ways without a sensor' },
    { steps: [
        { h3: 'Walk it and tap each corner through the camera',
          p: 'Plain ARKit motion tracking, which every modern iPhone has. Point at the foot of '
           + 'each corner, tap, walk to the next. Coming back to the first corner and tapping '
           + 'it again is what tells the app how well the walk went — and that closing gap is '
           + 'where the tolerance on every wall comes from.' },
        { h3: 'Tap the corners onto a grid',
          p: 'No camera at all. Tap the shape of the room onto a grid, then put your tape '
           + 'readings on the walls. This is also the only method that works for a room you '
           + 'cannot get back into — an old drawing, a rental you have seen once, a house that '
           + 'is not built yet.' },
      ] },
    { p: 'Both are free in ScanToBid. Measuring, the drawing and the 3D view are not part of '
       + 'the subscription and never will be.' },

    { h2: 'The honest recommendation' },
    { p: 'If you are buying a phone specifically for this work, a Pro model saves real time on '
       + 'every job and pays for itself in a season. If you already have a non-Pro iPhone, do '
       + 'not buy a new one for it — the fallbacks are genuinely usable, and on the jobs where '
       + 'a scan goes wrong they are what you would fall back to anyway.' },
    { h2: 'What LiDAR does not buy you' },
    { p: 'It is worth being precise about this, because the marketing around depth sensors '
       + 'implies otherwise. LiDAR does not make a measurement authoritative. It produces a '
       + 'depth map, and software turns that into planes it has decided are walls — an '
       + 'interpretation that is usually excellent and occasionally confidently wrong.' },
    { p: 'It also does not help with the two things that most often produce a bad number: a '
       + 'mirror, and a wall you cannot see because there is a bookcase against it. Both are '
       + 'worse with a sensor than without one, because a sensor gives you a clean answer '
       + 'either way.' },

    { h2: 'The buying decision, honestly' },
    { table: {
        head: ['If you are…', 'Then'],
        rows: [
          ['Buying a phone anyway, and this is your work',
           'Get a Pro. It saves real minutes on every job and the difference is a season.'],
          ['On a non-Pro iPhone that works fine',
           'Do not replace it for this. The fallbacks are genuinely usable and free.'],
          ['Doing one or two rooms a month',
           'The fallbacks are plenty. LiDAR pays off on volume.'],
          ['Doing whole houses regularly',
           'A Pro pays for itself quickly — mostly in rooms you did not have to go back to.'],
        ] } },

    { h2: 'A test worth doing before you decide' },
    { p: 'Take whichever phone you have into a room you know the dimensions of. Measure it '
       + 'both ways — once with the sensor if you have one, once by tapping the corners — and '
       + 'compare both against a tape. You will learn more in fifteen minutes than from any '
       + 'amount of reading, including this page, and you will find out which method you '
       + 'personally are better at.' },
  ],
  faq: [
    { q: 'Which iPhones have LiDAR?',
      a: 'The Pro and Pro Max models from the iPhone 12 Pro onwards, plus the iPad Pro from '
       + '2020. Standard and Plus iPhones do not have the sensor. Check the current model’s '
       + 'spec page before buying — line-ups change.' },
    { q: 'Can I measure a room without LiDAR?',
      a: 'Yes, two ways. Walk the room and tap each corner through the camera using ordinary '
       + 'AR tracking, or skip the camera and tap the corners onto a grid before putting your '
       + 'tape readings on the walls.' },
    { q: 'Is a LiDAR scan more accurate than tapping corners?',
      a: 'Not necessarily — it is faster. A scan is the sensor’s interpretation of what it '
       + 'saw; a corner you tapped is somewhere you pointed at. Either way, a tape on one wall '
       + 'running each way is what makes the numbers defensible.' },
    { q: 'Is it worth upgrading to a Pro iPhone just for LiDAR?',
      a: 'If you are buying a phone anyway and this is your work, yes — it saves real minutes '
       + 'on every job. If your current non-Pro iPhone is fine, no. The fallbacks are usable, '
       + 'free, and are what you would fall back to on a difficult room regardless.' },
    { q: 'Does LiDAR make measurements more trustworthy?',
      a: 'It makes them faster, not more authoritative. A sensor produces a depth map and '
       + 'software decides which parts are walls — an interpretation that is usually good and '
       + 'occasionally confidently wrong, particularly around mirrors and blocked walls.' },
  ],
  related: ['lidar-room-scanning', 'best-room-measuring-apps', 'laser-measure-vs-phone-scan'],
  download: null,
},

{
  slug: 'laser-measure-vs-phone-scan',
  audience: 'compare',
  title: 'Laser measure vs phone scan: use both, for different things',
  metaTitle: 'Laser Measure vs Phone Scan: Which for What',
  description:
    'A laser gives you one very good number. A scan gives you the whole shape. Why '
    + 'the argument between them is the wrong argument.',
  keywords: ['laser measure vs phone', 'laser distance meter vs lidar',
             'best way to measure a room', 'disto vs phone app'],
  minutes: 6,
  standfirst:
    'These are not competitors. One is a tape that reaches further; the other is a '
    + 'sketch pad that draws itself.',
  blocks: [
    { h2: 'What each one is for' },
    { table: {
        head: ['', 'Laser distance meter', 'Phone scan'],
        rows: [
          ['Produces', 'One distance, to a good tolerance', 'The whole outline, plus openings'],
          ['Speed per room', 'Slow — one measurement at a time', 'About ninety seconds'],
          ['Records the shape', 'No, you write it down', 'Yes'],
          ['Finds the closet you forgot', 'No', 'Yes'],
          ['Needs light', 'Barely', 'Yes'],
          ['Bothered by mirrors and glass', 'Sometimes', 'Frequently'],
        ] } },
    { p: 'They fail in different places, which is precisely why carrying both is not '
       + 'redundant. The scan tells you what the room is; the laser tells you how long a '
       + 'specific wall is, to a tolerance you can quote.' },

    { h2: 'The workflow that uses both properly' },
    { steps: [
        { h3: 'Scan the room first',
          p: 'Get the shape, the openings and the things you would have forgotten. Two '
           + 'minutes.' },
        { h3: 'Look at the plan and decide what matters',
          p: 'Usually one wall running each way — those two pin the whole outline. Sometimes '
           + 'a third, on an odd shape.' },
        { h3: 'Shoot those walls with the laser',
          p: 'Type each reading in against the wall it belongs to.' },
        { h3: 'Let the rest follow',
          p: 'Once two walls running different ways are measured, the app can reconcile the '
           + 'outline around them — and every quantity moves with it.' },
      ] },
    { p: 'That is the sequence ScanToBid is built around. It will tell you which walls are '
       + 'worth measuring and why — the longest wall first, because an error there costs the '
       + 'most floor area — and every document says which walls have been done until they all '
       + 'have.' },

    { h2: 'When the laser is the only tool' },
    { p: 'Cramped mechanical spaces, exteriors at distance, anywhere too dark to track, and '
       + 'anywhere with a mirrored wall. Type the readings onto a grid you tapped out and you '
       + 'have a measured room with no sensor involved at all.' },
    { h2: 'What a laser is genuinely better at' },
    { ul: [
        'Long distances outdoors, where a phone has nothing to track against.',
        'Ceiling heights in a tall room, from the floor, in one shot.',
        'Anywhere too dark for a camera to track.',
        'Diagonals across a room, which is how you find out whether a "rectangle" is square.',
        'Repeated measurements of the same thing, where you want to see whether they agree.',
      ] },
    { p: 'That last one is underrated. Shooting a wall three times and getting three different '
       + 'numbers tells you something is wrong with the shot — a bad target surface, a bad '
       + 'angle — and that is a check no scan gives you.' },

    { h2: 'The diagonal trick' },
    { p: 'A room that measures 12 × 14 on all four walls is not necessarily square. Measure '
       + 'both diagonals: in a true rectangle they are equal. If they differ, the room is a '
       + 'parallelogram and every quantity that assumes right angles is slightly wrong.' },
    { formula: 'square if diagonal A = diagonal B',
      note: 'On a 12 × 14 room both diagonals should be about 18 ft 5 in.' },
    { p: 'A phone scan will usually show you an out-of-square room correctly, because it is '
       + 'building the outline from geometry rather than from four numbers. That is one of the '
       + 'places the scan genuinely beats a tape and a pad.' },

    { h2: 'What to buy, if you are buying' },
    { p: 'Any laser distance meter with a decent quoted tolerance will do this work. The '
       + 'features worth paying for are a Bluetooth link if you want readings typed for you, a '
       + 'clear display in bright light, and a tripod thread if you shoot long distances. '
       + 'Everything beyond that is convenience.' },
  ],
  faq: [
    { q: 'Is a laser measure more accurate than a phone?',
      a: 'For a single distance, yes — that is what it is built for, and it will quote you a '
       + 'tolerance. But it does not record the shape of the room or find the openings, which '
       + 'is what the scan is for. The two do different jobs.' },
    { q: 'Do I still need a tape measure?',
      a: 'Something has to give you a real measurement of a real wall — tape or laser, either '
       + 'is fine. What matters is that it happens before you price anything, on at least one '
       + 'wall running each way.' },
    { q: 'Can I type laser readings into a measuring app?',
      a: 'That is the intended workflow: scan the room for its shape, then type your laser '
       + 'readings against the walls that matter. In ScanToBid a typed reading is recorded as '
       + 'measured and changes every quantity that depends on it.' },
    { q: 'How do you check whether a room is square?',
      a: 'Measure both diagonals. In a true rectangle they are equal; if they differ, the room '
       + 'is a parallelogram and any quantity that assumes right angles is slightly wrong. On a '
       + '12 × 14 room both diagonals should be about 18 ft 5 in.' },
    { q: 'What features matter on a laser distance meter?',
      a: 'A tolerance you trust, a display you can read in bright light, and a tripod thread if '
       + 'you shoot long distances. A Bluetooth link is worth it if you want readings typed '
       + 'into an app rather than onto a pad.' },
  ],
  related: ['lidar-room-scanning', 'do-i-need-lidar-iphone', 'best-room-measuring-apps'],
  download: null,
},

{
  slug: 'roomplan-vs-photogrammetry',
  audience: 'compare',
  title: 'RoomPlan vs photogrammetry: two different jobs',
  metaTitle: 'RoomPlan vs Photogrammetry for Construction',
  description:
    'One produces a room made of walls, doors and windows. The other produces a mesh. '
    + 'Which you want depends entirely on whether you need to price it.',
  keywords: ['roomplan vs photogrammetry', 'polycam vs roomplan', '3d room scanning',
             'photogrammetry construction'],
  minutes: 8,
  standfirst:
    'A mesh is a picture of a room. A room is walls, openings and dimensions. Only '
    + 'one of them can be taken off.',
  blocks: [
    { h2: 'What each one gives you' },
    { p: 'Photogrammetry reconstructs a three-dimensional surface from many overlapping '
       + 'photographs. What comes out is a mesh — an extremely detailed skin of whatever you '
       + 'photographed, with no opinion about what any of it is.' },
    { p: 'Apple’s RoomPlan takes depth and motion data and produces something different in '
       + 'kind: a room made of identified objects. Walls with dimensions. Doors. Windows. '
       + 'Openings. Furniture, labelled.' },
    { table: {
        head: ['', 'Photogrammetry mesh', 'RoomPlan room'],
        rows: [
          ['Output', 'A surface', 'Walls, doors, windows, openings'],
          ['Knows what a wall is', 'No', 'Yes'],
          ['Can be taken off', 'Not directly', 'Yes'],
          ['Detail', 'Very high', 'Simplified to planes'],
          ['Capture time', 'Minutes, plus processing', 'About ninety seconds, live'],
          ['Good for', 'Exteriors, objects, condition records', 'Interiors you need to price'],
        ] } },

    { h2: 'Why "it knows what a wall is" is the whole difference' },
    { p: 'A takeoff needs a perimeter, a ceiling height, and a list of openings to deduct. A '
       + 'mesh has none of those as data — you can measure across it in a viewer, but there is '
       + 'nothing in the file that says "this is a wall, it is 12 ft 4 in long, and there is a '
       + '3 ft door in it".' },
    { p: 'That is why estimating tools built on interiors use RoomPlan or something like it, '
       + 'and why photogrammetry sits alongside as a record rather than as a measurement.' },

    { h2: 'Where photogrammetry is genuinely better' },
    { ul: [
        'Exteriors — roofs, elevations, anything you cannot walk around inside.',
        'Condition records where the detail IS the point: a damaged surface, a texture, a crack.',
        'Objects rather than spaces.',
        'Anywhere you need to show what something looked like rather than how big it was.',
      ] },

    { h2: 'And the caveat both share' },
    { p: 'Both produce geometry that looks authoritative and neither one measured your wall '
       + 'with a tape. Whatever the capture method, the number you put on a contract should '
       + 'have had a physical measurement behind it — which is why ScanToBid records the method '
       + 'against every length and says so on the page.' },
    { h2: 'Capture time, and what that does to a job' },
    { p: 'This is the practical difference more often than the technical one. A RoomPlan-style '
       + 'walk is about ninety seconds and you watch the room build as you go, so you know on '
       + 'the spot whether it worked. Photogrammetry is a careful photographic pass followed by '
       + 'processing, and you find out whether it worked later — sometimes after you have left.' },
    { p: 'On a job where you are measuring six rooms, that difference decides which one you '
       + 'actually use.' },

    { h2: 'Using both on the same job' },
    { steps: [
        { h3: 'Walk each room for its geometry',
          p: 'Shape, openings, and the quantities you will price off.' },
        { h3: 'Photograph what the geometry cannot carry',
          p: 'Condition, damage, texture, the state of a surface. This is where detail matters '
           + 'and where a mesh or a good set of photographs earns its place.' },
        { h3: 'Keep them attached to each other',
          p: 'A photograph that is not tied to a wall in a room is a photograph nobody can '
           + 'locate six weeks later.' },
      ] },
    { p: 'That last step is the one that gets skipped, and it is why so many claim files are '
       + 'an email with thirty attachments. ScanToBid attaches each photograph to the damage it '
       + 'belongs to and prints them beside the measurements on one document.' },
  ],
  faq: [
    { q: 'Is RoomPlan the same as photogrammetry?',
      a: 'No. Photogrammetry reconstructs a surface from photographs and has no idea what any '
       + 'of it is. RoomPlan produces identified objects — walls with dimensions, doors, '
       + 'windows and openings — which is what a takeoff needs.' },
    { q: 'Can you take off quantities from a 3D mesh?',
      a: 'Not directly. You can measure across a mesh in a viewer, but there is nothing in the '
       + 'file identifying a wall, its length or the openings in it, so there is nothing to '
       + 'deduct or total.' },
    { q: 'Which should I use for insurance documentation?',
      a: 'Both, for different parts. RoomPlan-style capture for the room and its measurements, '
       + 'and detailed photographs — or photogrammetry where the detail matters — as the '
       + 'condition record. An adjuster needs both the size and the state.' },
    { q: 'Which is faster, RoomPlan or photogrammetry?',
      a: 'RoomPlan-style capture, by a wide margin — about ninety seconds a room, and you '
       + 'watch it build as you walk so you know immediately whether it worked. Photogrammetry '
       + 'needs a careful photographic pass and then processing, so you find out later.' },
    { q: 'Can I use both on the same job?',
      a: 'That is the sensible answer: capture the geometry for measurement, and photograph or '
       + 'scan in detail for condition. What matters is keeping them attached — a photograph '
       + 'not tied to a wall in a room is one nobody can locate later.' },
  ],
  related: ['lidar-room-scanning', 'best-room-measuring-apps', 'document-water-damage'],
  download: null,
},

];
