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
                            + "\(Entitlement.freeRooms) rooms kept. No account, no card."
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

                    if subscription.products.isEmpty {
                        ProgressView().frame(maxWidth: .infinity)
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
            .navigationTitle("Trueline")
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
    }
}
