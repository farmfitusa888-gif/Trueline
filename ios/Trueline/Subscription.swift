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

    /// Whether everything is unlocked.
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

    private var watcher: Task<Void, Never>?

    init() {
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
            }
        }
        subscribed = found
        known = true
    }

    /// Loads what is on sale.
    func load() async {
        do {
            let found = try await Product.products(for: Plan.allCases.map(\.rawValue))
            // Yearly first: it is the better deal and the one worth reading
            // first, and sorting by price puts it second.
            products = found.sorted { $0.price > $1.price }
            await refresh()
        } catch {
            trouble = "The App Store could not be reached, so the plans are not showing. "
                + "Everything you have already paid for still works."
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
}
