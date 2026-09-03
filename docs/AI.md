# Free AI for ScanToBid — what is actually available, and what is worth using

Researched 2026-08-27. Every figure here has a source at the bottom. Nothing in
this file has been built. It exists so the decision is made once, on the facts,
and recorded.

## The rule this has to live inside

From `CLAUDE.md`, unchanged:

> **AI is language, never facts and never money.** Facts and figures come from
> SQL; a provider orders and phrases them. Prices come from the company's own
> accepted-estimate history. Nothing AI produces writes to the ledger or posts.

For ScanToBid that reads: **an AI may never produce a measurement, a quantity, a
rate or a total.** Those come from `core/`, out of `bigint` nanometres and cents,
and they are what the product is. An AI may write the sentences around them.

That rule is not a limitation to work around. It is the reason a contractor
could put the output in front of a client at all.

## The candidates

### 1. Apple Foundation Models — free, on-device, no key, no bill

Introduced in iOS 26. Gives an app direct access to the same ~3-billion-parameter
model that powers Apple Intelligence, running **entirely on the phone**: no API
key, no per-token bill, no network round trip, and it works with no signal.

For this app specifically, that last part is not a nice-to-have. The person using
ScanToBid is standing in an unfinished basement. Every other option on this page
needs bars.

**What it costs ScanToBid:** nothing. No account, no key, no quota, no vendor.

**What it costs the user:** nothing, and none of their client's data leaves the
phone — which is the same promise the rest of the app already makes about
photographs and rooms.

**The catch, and it is a real one.** The model runs only on Apple
Intelligence-capable hardware — A17 Pro, M1, or later — in supported regions,
with the feature switched on in Settings and the model downloaded.
`SystemLanguageModel.default.availability` answers this, with a reason when the
answer is no. This project's deployment target is **iOS 17.0**, so anything
built on it has to be behind an availability check and the app has to be whole
without it.

That is the same shape as every other optional thing in this app: iCloud when
there is an account, EventKit when there is a calendar, LiDAR when there is a
sensor. The pattern already exists.

### 2. GitHub Models — free, and not for this

Free with a GitHub account, and genuinely useful for prototyping. It is not a
production dependency for this app, for three separate reasons, any one of which
would be enough:

- **Rate limits.** Roughly 10 requests a minute on the free tier, with high-tier
  models capped near 50 requests *a day*. A contractor writing four proposals on
  a Tuesday would hit that.
- **Token limits.** 8K in / 4K out across all tiers.
- **It is the wrong place for a client's data.** The guidance on the free tier is
  explicit that production and customer data do not belong on it. A homeowner's
  address, a loss description and a claim number are exactly that.

Worth keeping in mind for *development* — writing fixtures, drafting handbook
copy — where no client data is involved. Not in the app.

### 3. Anthropic / OpenAI / anything with a key

Already covered by `CLAUDE.md`: a paid integration stays behind a provider
interface with a working free path, and **pricing gets approved before anything
is connected**. Nothing here changes that. If a cloud model is ever added, it
goes behind the same interface the on-device one uses, and the free path is the
on-device one.

Worth noting for later: WWDC 2026 opened the Foundation Models framework to any
LLM provider through a public protocol layer, with Private Cloud Compute, Core AI
and MLX as model options and partner integrations announced. That means "add a
better model later" is a provider swap rather than a rewrite — which is another
argument for building against Apple's framework first.

## What is actually worth building, ranked

Each of these takes numbers the app already has and turns them into sentences.
None of them produces a number.

1. **The scope of work, in sentences.** The proposal already carries a takeoff
   and a price and asks the contractor to write "one line on what it covers".
   That line is the hardest thing on the screen to write and the most-read thing
   on the document. Feed it the *quantities and the room*, and it drafts the
   paragraph — which the contractor then edits. The money is untouched.
2. **The loss description on a claim.** Same shape, higher stakes: an adjuster
   reads it first. The damages, their kinds, their categories and the moisture
   readings are all in the model already; what is missing is somebody's ability
   to write four decent paragraphs standing in a wet basement.
3. **Naming what was marked.** A pin needs words or it is refused. On a phone,
   in the dark, with gloves on, typing "water staining to the ceiling, roughly
   three feet across, active" is the reason pins do not get made. Dictation plus
   a model that turns a mumble into a sentence and picks the damage *kind* is
   the difference between a claim with evidence and one without.
4. **Reading a supplier's price list.** The CSV importer already shows columns
   against the contractor's own rows before importing anything. A model that
   guesses the mapping — and shows it for approval, never applies it — turns a
   ten-minute job into a ten-second one, and every number still comes from the
   file.

What is deliberately **not** on this list: estimating a price, suggesting a rate,
"checking" a measurement, or writing anything that goes out without somebody
reading it first.

## Sources

- [Bring an LLM provider to the Foundation Models framework — WWDC26 Session 339](https://developer.apple.com/videos/play/wwdc2026/339/)
- [Meet the Foundation Models framework — WWDC25 Session 286](https://developer.apple.com/videos/play/wwdc2025/286/)
- [Apple's Foundation Models Framework: Run AI On-Device With Just a Few Lines of Swift](https://dev.to/arshtechpro/apples-foundation-models-framework-run-ai-on-device-with-just-a-few-lines-of-swift-lbp)
- [WWDC 2026 — Apple Just Opened the Foundation Models Framework to Any LLM Provider](https://dev.to/arshtechpro/wwdc-2026-apple-just-opened-the-foundation-models-framework-to-any-llm-provider-5ejn)
- [Getting Started with Foundation Models in iOS 26](https://www.appcoda.com/foundation-models/)
- [Exploring the Foundation Models framework](https://www.createwithswift.com/exploring-the-foundation-models-framework/)
- [GitHub Models Free Tier: Current Limits and Change History](https://getaitools.dev/service/github-models)
- [Best Free LLM API Tiers in 2026](https://wetheflywheel.com/en/ai-model-access/free-llm-api-tiers-2026/)
- [AI API Free Tiers 2026: Every Limit You Hit (and When)](https://pecollective.com/tools/ai-api-free-tiers/)
