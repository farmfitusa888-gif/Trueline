import StoreKit
import SwiftUI

/// What the subscription is, and what it costs.
///
/// The rule this screen is written to: **say what the thing does before saying
/// that it is paid.** A person who has just measured his own kitchen with this
/// app for nothing has earned a straight description of what he would be
/// buying. "Upgrade to unlock premium features" tells him only that he cannot
/// have it.
///
/// The list of what is paid is not written here. It comes from the same table
/// the gate reads, so this screen cannot advertise something the app does not
/// unlock, or quietly leave out something it does.
struct PaywallView: View {

    @ObservedObject var subscription: Subscription
    /// What they tapped to get here, so the first line is about that rather
    /// than about subscriptions in general.
    let asking: Entitlement.Feature?
    let onClose: () -> Void

    /// Whether Apple's redemption sheet is up.
    ///
    /// The sheet is Apple's own and this app never sees the code: it is typed
    /// into StoreKit, checked by the App Store, and comes back as an ordinary
    /// transaction that `Transaction.updates` picks up like any other. That is
    /// the whole reason to use it rather than a code list of our own -- a code
    /// this app checked would be a code anybody could read out of the binary.
    @State private var redeeming = false

    /// What happened to the last free run somebody tried to start, or nothing.
    @State private var runSaid: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {

                    if let asking {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(Entitlement.title(of: asking))
                                .font(.title2.weight(.bold))
                            Text(Entitlement.describe(asking))
                                .font(.body)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Text("Everything the measurements are for")
                            .font(.title2.weight(.bold))
                    }

                    // While ScanToBid is not on sale, this whole screen is a
                    // description of what is coming rather than a gate, and it
                    // has to say so. A mode nobody can see on the screen is a
                    // mode that ships still switched on -- see
                    // `Subscription.onSale`, which is the one line that decides
                    // this.
                    if Subscription.freeUntilLaunch {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Everything is on, free, right now")
                                .font(.subheadline.weight(.semibold))
                            Text(
                                "ScanToBid is not on the App Store yet, so there is nothing to "
                                + "buy and nothing is being withheld. Every part of it below is "
                                + "working on this phone today. When it does go on sale, "
                                + "measuring, the drawing, the 3D view and your first room stay "
                                + "free — the rest is what this page is about."
                            )
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(Entitlement.paid, id: \.self) { feature in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Image(systemName: "checkmark")
                                    .font(.footnote.weight(.bold))
                                    .foregroundStyle(.tint)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(Entitlement.title(of: feature))
                                        .font(.subheadline.weight(.semibold))
                                    Text(Entitlement.describe(feature))
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }

                    Divider()

                    // Measuring stays free, said on the screen that sells the
                    // rest. Somebody deciding not to pay should leave knowing
                    // exactly what they still have.
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Free, with or without this")
                            .font(.subheadline.weight(.semibold))
                        Text(
                            "Scanning, walking a room, the plan, the 3D view, correcting "
                            + "anything on it, and the room's dimensions. Up to "
                            + "\(Entitlement.roomsKept()) kept. No account, no card."
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }

                    // The founding terms, said out loud rather than left for
                    // somebody to work out from two prices. Shown only while
                    // the products on sale are still named as the founding
                    // ones -- see `Subscription.founding` for why the claim is
                    // tied to that and not to a number written in here.
                    if let prices = subscription.foundingPrices {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Founding rate — the first 100")
                                .font(.subheadline.weight(.semibold))
                            Text(
                                "\(prices). Apple keeps that price for you for as long as you "
                                + "stay subscribed, even after it goes up for everybody else — "
                                + "so it is a promise the App Store enforces rather than one "
                                + "anybody has to remember."
                            )
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.accentColor.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
                    }

                    // Three states, and the middle one is the one that gets an
                    // app rejected. `Product.products` returns an EMPTY LIST and
                    // no error at all while the in-app purchases are still
                    // waiting to be approved in App Store Connect, so a screen
                    // that draws a spinner whenever the list is empty draws it
                    // forever, in front of an App Review tester looking for the
                    // subscription. Silence and emptiness are different answers
                    // and this says which one it got.
                    if !subscription.productsKnown {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if subscription.products.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("The plans are not showing")
                                .font(.subheadline.weight(.semibold))
                            Text(
                                "The App Store has not given this app anything to sell. That is "
                                + "either no signal, or the subscription is still being approved. "
                                + "Nothing is wrong with what you have measured, and everything "
                                + "you have already paid for still works — try this screen again "
                                + "in a little while."
                            )
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
                    } else {
                        VStack(spacing: 10) {
                            ForEach(subscription.products, id: \.id) { product in
                                Button {
                                    Task {
                                        if await subscription.buy(product) { onClose() }
                                    }
                                } label: {
                                    VStack(spacing: 3) {
                                        Text(product.displayName)
                                            .font(.headline)
                                        if let offer = subscription.offer(on: product) {
                                            Text(offer).font(.footnote)
                                        } else {
                                            Text(product.displayPrice).font(.footnote)
                                        }
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(subscription.working)
                            }
                        }
                    }

                    if let trouble = subscription.trouble {
                        Text(trouble)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    // A set time on the house. Two ways in, and the order is
                    // deliberate: the code first, because a code is somebody
                    // being handed something by name and Apple stops it being
                    // used twice; the run on the phone second, because it works
                    // with no App Store at all, which is where this app is
                    // until the products are approved.
                    VStack(alignment: .leading, spacing: 10) {
                        if let said = subscription.freeRunSaid {
                            Text(said)
                                .font(.footnote.weight(.semibold))
                                .fixedSize(horizontal: false, vertical: true)
                        } else if !subscription.subscribed && !subscription.freeRunTaken {
                            Button("Try everything free for \(Subscription.freeRunOffered) days") {
                                Task {
                                    let started = await subscription.giveFreeRun(
                                        days: Subscription.freeRunOffered,
                                        why: "the free run from this screen"
                                    )
                                    runSaid = started
                                        ? nil
                                        : "This phone has already had its free run."
                                }
                            }
                            .font(.footnote.weight(.semibold))
                        } else if subscription.freeRunTaken && !subscription.subscribed {
                            Text("The free run on this phone has finished.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }

                        Button("Redeem a code") { redeeming = true }
                            .font(.footnote)
                            .disabled(subscription.working)

                        if let runSaid {
                            Text(runSaid)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Button("Already paid? Put it back") {
                        Task { await subscription.restore() }
                    }
                    .font(.footnote)
                    .disabled(subscription.working)
                    .frame(maxWidth: .infinity)

                    Text(
                        "It renews until you stop it, and you stop it in the App Store rather "
                        + "than by asking anybody. Cancelling leaves every room you have "
                        + "measured on the phone."
                    )
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
                .padding(20)
            }
            .navigationTitle("ScanToBid")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Not now", action: onClose)
                }
            }
            .overlay {
                if subscription.working {
                    ProgressView().controlSize(.large)
                }
            }
        }
        .task { await subscription.load() }
        // Apple's own sheet. The code goes to the App Store and comes back as
        // an ordinary transaction, which `Transaction.updates` in `Subscription`
        // already listens for -- so nothing here has to unlock anything, and
        // there is no code list in this app for anybody to read out of it.
        .offerCodeRedemption(isPresented: $redeeming) { outcome in
            if case .failure(let error) = outcome {
                runSaid = "That code could not be used: \(error.localizedDescription)"
            }
        }
    }
}
