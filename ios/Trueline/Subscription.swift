import Combine
import Foundation
import StoreKit

/// Whether this person has paid, and the only place that is decided.
///
/// StoreKit 2 rather than the original API: transactions arrive already
/// verified by Apple, `Transaction.currentEntitlements` is the whole question
/// answered in one place, and there is no receipt to parse and no server to
/// validate against. That last part matters more than it sounds -- a receipt
/// validation server would be the first thing in this product with a monthly
/// bill attached, and there is nothing it would buy that this does not.
///
/// ## What this deliberately does not do
///
/// It does not phone anywhere. It does not count how many times a feature was
/// used. It does not degrade quietly when the network is down: `subscribed`
/// starts from what StoreKit last knew and is corrected as soon as it can be,
/// so a contractor on a job site with no signal keeps everything he has paid
/// for. An app that locks a paid feature because a basement has no bars is an
/// app that gets deleted in a basement.
///
/// ## The gate
///
/// One published property, read by every screen through `Entitlement`. The
/// list of what is free and what is paid lives in `core/src/entitlement.ts` and
/// is shared with the web half, because a gate implemented twice is a gate that
/// disagrees with itself.
@MainActor
final class Subscription: ObservableObject {

    /// The product identifiers, as they are in App Store Connect.
    ///
    /// Two of them and no more. One paid plan is a decision somebody can make
    /// standing in a kitchen; four is a spreadsheet.
    enum Plan: String, CaseIterable {
        case monthly = "com.sunnyacres.trueline.pro.monthly"
        case yearly = "com.sunnyacres.trueline.pro.yearly"
    }

    /// Whether ScanToBid is on sale on the App Store yet.
    ///
    /// # This is the switch. There is one, and it is this line.
    ///
    /// > "WE NEED EVERYTHING TO BE FREE UNTIL WE LAUNCH ON THE APP STORE"
    ///
    /// While this is `false`, every paid feature is on for everybody, on every
    /// build, with no code to buy and nobody to charge. Nothing is on sale, so
    /// nothing is withheld -- charging for a subscription that cannot be bought
    /// is the app taking something away for no reason at all.
    ///
    /// **Flip it to `true` the day ScanToBid goes on sale.** One word, in one
    /// file, done once. It is `let` and not `var` on purpose: nothing at
    /// runtime -- no setting, no gesture, no debug menu, no message from the
    /// web view -- can move it, so what a build does about money is decided
    /// entirely by what is written here.
    ///
    /// ## Why it is not `#if DEBUG`, and why that matters
    ///
    /// `Subscription.testing` below is `#if DEBUG` because it is for the
    /// developer's own phone. This is not that. The people testing before
    /// launch are on TestFlight, and a TestFlight build is a **Release** build
    /// -- `#if DEBUG` is compiled out of it -- so a giveaway written that way
    /// would show a paywall to every tester and sell them nothing, which is the
    /// exact bug `testing` was invented for, one level up.
    ///
    /// ## Why the App Store build must NOT be in this mode
    ///
    /// > "AND WE'LL NEED TO LEAVE IT UNLOCKED FOR THE APP STORE REVIEW OR NO?"
    ///
    /// No. App Review tests in-app purchases in Apple's **sandbox**, where a
    /// purchase costs the reviewer nothing; that is the normal path and the one
    /// Apple expects to find. A build submitted with this still `false` gives
    /// the whole product away to every customer from the first day, and the
    /// only symptom is that nobody ever pays.
    ///
    /// There is deliberately no reviewer code and no hidden unlock. A back door
    /// is a rejection risk in its own right, and a door anybody can find.
    ///
    /// `python3 core/tools/check-paywall.py --release` refuses a build that is
    /// going on sale with this still `false`. Run it before you archive.
    static let onSale = false

    /// Everything on, for everybody, because there is nothing to buy yet.
    ///
    /// Named so the reason reads at the place it is used. Every screen in the
    /// app, web half included, gets its answer through `subscribed` below and
    /// never has to know which of the reasons was the true one.
    static var freeUntilLaunch: Bool { !onSale }

    /// Whether everything is on.
    ///
    /// `false` until StoreKit has been asked, which is a fraction of a second
    /// at launch. Nothing paid is shown as available in that window, and
    /// nothing free is hidden.
    @Published private(set) var subscribed = false

    /// What is on sale, once the store has answered.
    @Published private(set) var products: [Product] = []

    /// What went wrong, in words, or nothing.
    ///
    /// Every failure here is somebody trying to give you money, so none of them
    /// is allowed to be silent.
    @Published private(set) var trouble: String?

    /// True while a purchase or a restore is in flight, so a button can say so
    /// rather than looking dead.
    @Published private(set) var working = false

    /// True once the first entitlement check has finished, so a screen can tell
    /// "not subscribed" from "not asked yet" and avoid flashing a paywall at
    /// somebody who has paid.
    @Published private(set) var known = false

    /// True once the store has answered about what is on sale, however it
    /// answered -- including "nothing".
    ///
    /// The difference between *still loading* and *there is nothing on sale*
    /// cannot be read off `products` being empty, and getting that wrong is a
    /// rejection: until the in-app purchases are approved, `Product.products`
    /// returns an empty list with no error at all, and a paywall that shows a
    /// spinner for that is a screen an App Review tester sits in front of
    /// forever. With this, the screen can say what is happening.
    @Published private(set) var productsKnown = false

    /// When the free run on this phone ends, or nothing if it never had one.
    @Published private(set) var freeRunEndsAt: Date?

    /// What the free run was given for, in whatever words it was given in.
    @Published private(set) var freeRunWhy = ""

    /// What this phone's browser unlock code is made from.
    ///
    /// The paid screens are shut in a browser exactly as they are here, and
    /// there is no login anywhere in ScanToBid to ask instead. Here Apple says
    /// who paid; in a browser a code does. This is the seed that code is made
    /// from, and `makeUnlockCode` in `web/src/roomLink.ts` is the arithmetic --
    /// one implementation, on the web side, so that the two halves cannot
    /// quietly disagree the day the format changes.
    ///
    /// Apple's ORIGINAL transaction identifier where there is a purchase, so
    /// the same subscription always makes the same code however many times the
    /// app is reinstalled. A UUID this app keeps to itself where there is not,
    /// which covers the free run and the two people testing it.
    ///
    /// It never leaves the phone. What leaves is two rounds of FNV-1a over it,
    /// so nothing about the purchase can be read back out of the code.
    @Published private(set) var unlockSeed = Subscription.keptSeed()

    /// The seed for a phone with no purchase behind it, made once and kept.
    private static func keptSeed() -> String {
        if let kept = UserDefaults.standard.string(forKey: unlockSeedKey), !kept.isEmpty {
            return kept
        }
        let made = UUID().uuidString
        UserDefaults.standard.set(made, forKey: unlockSeedKey)
        return made
    }

    private var watcher: Task<Void, Never>?

    init() {
        // The free run this phone was given, before anything else asks. Read
        // here rather than on demand so `subscribed` is worked out in one
        // place, and no screen ever has to know where it is kept.
        freeRunEndsAt = UserDefaults.standard.object(forKey: Self.freeRunEndsKey) as? Date
        freeRunWhy = UserDefaults.standard.string(forKey: Self.freeRunWhyKey) ?? ""

        // Transactions can arrive at any moment -- a purchase made on another
        // device, a subscription renewing, a refund, a family member sharing
        // it. Without this listener the app would show the right answer only at
        // launch, and a renewal in the middle of a job would look like a
        // cancellation.
        watcher = Task { [weak self] in
            for await update in Transaction.updates {
                guard let self else { return }
                if case .verified(let transaction) = update {
                    await transaction.finish()
                }
                await self.refresh()
            }
        }
    }

    deinit {
        watcher?.cancel()
    }

    /// Asks StoreKit what this Apple ID is entitled to.
    func refresh() async {
        var found = false
        for await entitlement in Transaction.currentEntitlements {
            // `.unverified` means Apple could not vouch for it. It is not
            // treated as a subscription -- but it is not treated as an attack
            // either, and nothing is said to the person about it, because the
            // ordinary cause is a device restored from a backup rather than
            // anybody doing anything.
            guard case .verified(let transaction) = entitlement else { continue }
            guard Plan(rawValue: transaction.productID) != nil else { continue }
            if transaction.revocationDate == nil {
                found = true
                // The ORIGINAL identifier rather than this renewal's, so the
                // code a contractor pasted into his browser in March is still
                // the code his phone shows him in September.
                unlockSeed = String(transaction.originalID)
            }
        }
        // Four ways to be entitled and only the first is money, in the order
        // somebody would say them out loud. All four are worked out again here
        // rather than remembered, so a free run that ran out overnight is off
        // the next time anything asks.
        subscribed = found || freeRunning || Self.testing || Self.freeUntilLaunch
        known = true
    }

    /// Everything unlocked, for the two people testing this before it is on
    /// sale.
    ///
    /// ## Why this exists
    ///
    /// The takeoff, the price, the proposal, the claim and the exports are all
    /// behind the subscription. Nothing is on sale yet, so on a real phone
    /// there is nothing StoreKit can sell and nothing it can restore -- and
    /// every one of those screens correctly showed the paywall. From the
    /// outside that reads as *"takeoff still doesn't work"*, which is what it
    /// was reported as.
    ///
    /// A StoreKit configuration file only applies to a run launched FROM Xcode
    /// with that scheme. `bash build.sh` installs a build and launches it on
    /// its own, so the configuration is not in play and the store is empty.
    ///
    /// ## Why it cannot ship
    ///
    /// `#if DEBUG` is compiled out entirely of a Release build -- the branch
    /// does not exist in the binary that would go to the App Store, and there
    /// is no flag, no setting and no gesture that turns it on there. A TestFlight
    /// or App Store build is Release. This is true for a debug build on a
    /// developer's own phone and nowhere else.
    ///
    /// `check-swift-testing.py` fails the build if this ever loses its `#if`.
    static var testing: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }

    /// Loads what is on sale.
    ///
    /// `productsKnown` is set on both ways out, and that is the whole reason it
    /// exists: an empty list is a real, silent answer from StoreKit -- it is
    /// what comes back while the in-app purchases are still waiting to be
    /// approved -- and a screen that cannot tell it from "still asking" shows a
    /// spinner that never stops.
    func load() async {
        do {
            let found = try await Product.products(for: Plan.allCases.map(\.rawValue))
            // Yearly first: it is the better deal and the one worth reading
            // first, and sorting by price puts it second.
            products = found.sorted { $0.price > $1.price }
            productsKnown = true
            await refresh()
        } catch {
            trouble = "The App Store could not be reached, so the plans are not showing. "
                + "Everything you have already paid for still works."
            productsKnown = true
            known = true
        }
    }

    /// Buys one.
    ///
    /// Returns whether anything was bought, so a screen can close itself rather
    /// than guessing from a published property that has not updated yet.
    @discardableResult
    func buy(_ product: Product) async -> Bool {
        working = true
        trouble = nil
        defer { working = false }
        do {
            // Read, then switch. `switch try await x() { }` is valid Swift and
            // means the same thing; it is written out because the grammar
            // core/tools/check-swift.py uses does not accept the inline form,
            // and a syntax check that has to be switched off is worth nothing.
            let outcome = try await product.purchase()
            switch outcome {
            case .success(let verification):
                if case .verified(let transaction) = verification {
                    await transaction.finish()
                    await refresh()
                    return subscribed
                }
                trouble = "That purchase could not be verified with Apple, so nothing has been "
                    + "unlocked and nothing has been charged that Apple will not sort out."
                return false
            case .userCancelled:
                // Not a failure and not worth a message. Somebody changed their
                // mind, which they are allowed to do.
                return false
            case .pending:
                trouble = "This is waiting on approval -- Ask to Buy, or a payment method that "
                    + "needs confirming. It will unlock by itself when it goes through."
                return false
            @unknown default:
                trouble = "The App Store gave an answer this app does not know how to read. "
                    + "Nothing was unlocked."
                return false
            }
        } catch {
            trouble = "That did not go through: \(error.localizedDescription)"
            return false
        }
    }

    /// Puts back a subscription bought on another device, or before a reinstall.
    ///
    /// Apple requires this to exist and it is a rejection if it does not. It is
    /// also the thing that saves somebody who changed phones the week their
    /// season started.
    func restore() async {
        working = true
        trouble = nil
        defer { working = false }
        do {
            try await AppStore.sync()
            await refresh()
            if !subscribed {
                trouble = "Nothing to put back on this Apple ID. If you paid with a different "
                    + "one, sign in with that one in Settings and try again."
            }
        } catch {
            trouble = "Could not reach the App Store to check: \(error.localizedDescription)"
        }
    }

    /// What a plan costs, in the money of wherever the person is.
    ///
    /// `displayPrice` rather than formatting a number here: the store already
    /// knows the currency, the symbol and where it goes, and every attempt to
    /// do that by hand gets a country wrong.
    func price(of product: Product) -> String { product.displayPrice }

    /// Whether the plans on sale are still the founding ones.
    ///
    /// ## Why it is read off the product and not written here
    ///
    /// The screen says "the first 100 subscribers", and this app cannot count
    /// subscribers -- it never phones anywhere, which is the point of it. A
    /// number hard-coded here would go on being said long after it stopped
    /// being true, and the first person to be told a founding rate that has
    /// already ended is the person who finds out this app lies.
    ///
    /// So the claim is tied to the thing that actually decides it. The founding
    /// products are named "Founding rate" in App Store Connect. Rename them
    /// when the hundred are gone and this screen stops making the promise the
    /// same day, with no app update and nothing to remember.
    ///
    /// **That rename is the mechanism.** It is not a nicety: leaving the
    /// products named "Founding" past the hundredth subscriber is the app
    /// saying something untrue, and no code here can catch it.
    var founding: Bool {
        products.contains { $0.displayName.localizedCaseInsensitiveContains("founding") }
    }

    /// What the founding plans cost, in the store's own words.
    ///
    /// Built from `displayPrice`, so it is whatever App Store Connect says in
    /// whatever currency the person is buying in -- never a figure typed into
    /// this file. Returns nothing until the store has answered, because a price
    /// this app made up is worse than a price it has not shown yet.
    var foundingPrices: String? {
        guard founding else { return nil }
        let said = products.compactMap { product -> (Int, String)? in
            guard let period = product.subscription?.subscriptionPeriod else { return nil }
            switch period.unit {
            case .month where period.value == 1: return (0, "\(product.displayPrice) a month")
            case .year where period.value == 1: return (1, "\(product.displayPrice) a year")
            default: return nil
            }
        }
        .sorted { $0.0 < $1.0 }
        .map(\.1)

        guard !said.isEmpty else { return nil }
        return said.joined(separator: ", or ")
    }

    /// The introductory offer on a plan, said plainly, or nothing.
    ///
    /// Read from the product rather than written into the app, so changing the
    /// trial in App Store Connect changes what the screen says. A hard-coded
    /// "7 days free" beside a product that no longer offers one is a promise
    /// the app cannot keep.
    func offer(on product: Product) -> String? {
        guard let intro = product.subscription?.introductoryOffer else { return nil }
        let count = intro.period.value
        let unit: String
        switch intro.period.unit {
        case .day: unit = count == 1 ? "day" : "days"
        case .week: unit = count == 1 ? "week" : "weeks"
        case .month: unit = count == 1 ? "month" : "months"
        case .year: unit = count == 1 ? "year" : "years"
        @unknown default: return nil
        }
        switch intro.paymentMode {
        case .freeTrial: return "\(count) \(unit) free, then \(product.displayPrice)"
        case .payAsYouGo: return "\(intro.displayPrice) a \(unit) for \(count), then \(product.displayPrice)"
        case .payUpFront: return "\(intro.displayPrice) for the first \(count) \(unit)"
        default: return nil
        }
    }

    // ==================================================================
    // Free runs — a set time on the house, for marketing and for trials
    // ==================================================================
    //
    // > "I NEED A WAY TO SETUP FREE PROFILES AND FOR HOW LONG FOR MARKETING
    // >  AND TRIAL"
    //
    // Two mechanisms, and both of them are real. Nothing here invents an API
    // and nothing here needs a server.
    //
    //   1. **Apple's own.** An *offer code* is a code Apple generates in App
    //      Store Connect and redeems inside the app -- it can be free for a
    //      period, it can be handed to one person or printed on a card for a
    //      trade show, and Apple stops it being used twice. An *introductory
    //      offer* is the same idea aimed at everybody: the first month free, set
    //      once against the product. Both cost nothing, both are configured in
    //      App Store Connect rather than written here, and both end by
    //      themselves. `PaywallView` opens the redemption sheet; `offer(on:)`
    //      above reads whatever introductory offer the product carries so the
    //      screen says what the store actually says.
    //
    //   2. **A run recorded on this phone**, below. It works with no App Store
    //      connection at all, which is the reason to have it: before the
    //      products are approved -- which is where this app is today -- Apple
    //      has nothing to redeem, and a person Sam wants to hand the app to
    //      still needs it to work for a fortnight.
    //
    // ## What the local run is honestly worth
    //
    // It is a note on a phone, not a lock. Delete the app and reinstall and it
    // is gone with the rest of the app's settings, which means somebody
    // determined can take another one. That is said here rather than papered
    // over, because the alternative -- an identifier that survives a reinstall
    // -- means tracking a device, and this app does not phone anywhere.
    //
    // For a run somebody must not be able to take twice, use an offer code.
    // That is exactly the job Apple's mechanism does, at Apple's expense.

    /// The longest free run this app will hand out, in days.
    ///
    /// A quarter. Long enough to carry somebody through a busy season on a
    /// trade-show handout, short enough that a run given and forgotten ends by
    /// itself rather than becoming a subscription nobody remembers granting.
    /// `giveFreeRun` clamps to it, so no caller can hand out a year by typing a
    /// wrong number.
    static let longestFreeRun = 90

    /// How long the free run offered on the paywall is, in days.
    ///
    /// A fortnight. Long enough to measure a real job, price it, put a proposal
    /// in front of a homeowner and find out whether it wins work -- which is
    /// the only question a contractor is actually asking. Short enough that it
    /// is a trial rather than a gift.
    ///
    /// One number, changed here, and the button and its sentence both follow.
    static let freeRunOffered = 14

    private static let unlockSeedKey = "trueline.unlock.seed"
    private static let freeRunEndsKey = "trueline.freeRun.endsAt"
    private static let freeRunWhyKey = "trueline.freeRun.why"

    /// Whether a free run is on right now.
    var freeRunning: Bool {
        guard let ends = freeRunEndsAt else { return false }
        return ends > Date()
    }

    /// Whether this phone has ever been given one, running or finished.
    ///
    /// The question the paywall asks before offering another, and it is
    /// deliberately not the same question as `freeRunning`: a run that has
    /// ended has still been taken.
    var freeRunTaken: Bool { freeRunEndsAt != nil }

    /// Whole days left of it, rounded up, or nothing when none is running.
    ///
    /// Rounded up and never below one, because a run with eleven hours in it
    /// has a day left in every sense a person means it. Saying "0 days left"
    /// about something that still works is the app disagreeing with itself.
    var freeRunDaysLeft: Int? {
        guard let ends = freeRunEndsAt, ends > Date() else { return nil }
        return max(1, Int((ends.timeIntervalSinceNow / 86_400).rounded(.up)))
    }

    /// Starts a free run on this phone, for a set number of days.
    ///
    /// Refuses if this phone has had one already, so the button cannot be
    /// pressed twice for a second fortnight. Returns whether it started, so a
    /// screen can say what happened rather than guess from a property that has
    /// not published yet.
    ///
    /// `why` is kept alongside it -- "trade show, Ogden", "Gilbert", "the
    /// fortnight before launch" -- because a free run nobody can account for
    /// six weeks later is a free run nobody can decide anything about.
    @discardableResult
    func giveFreeRun(days: Int, why: String) async -> Bool {
        guard !freeRunTaken else { return false }
        let length = min(max(days, 1), Self.longestFreeRun)
        let ends = Date().addingTimeInterval(Double(length) * 86_400)
        UserDefaults.standard.set(ends, forKey: Self.freeRunEndsKey)
        UserDefaults.standard.set(why, forKey: Self.freeRunWhyKey)
        freeRunEndsAt = ends
        freeRunWhy = why
        // Straight through the one place entitlement is decided, rather than
        // setting `subscribed` here. Two places that can turn the product on is
        // one more than this app is allowed to have.
        await refresh()
        return true
    }

    /// What the free run is, said in one line, or nothing when there is none.
    ///
    /// Built from the days left rather than from a date, because "6 days left"
    /// is what somebody wants to know and a date makes him do the arithmetic.
    var freeRunSaid: String? {
        guard let left = freeRunDaysLeft else { return nil }
        let days = left == 1 ? "1 day" : "\(left) days"
        return freeRunWhy.isEmpty
            ? "Everything is on for another \(days)."
            : "Everything is on for another \(days) — \(freeRunWhy)."
    }
}
