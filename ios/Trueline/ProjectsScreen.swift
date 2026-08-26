import SwiftUI
import UIKit

/// What is on this phone.
///
/// No account, no server, no monthly bill. A scan is a folder in this app's
/// Documents directory, which also means it is visible in the Files app — so a
/// scan can be copied off, backed up or sent to somebody without Trueline
/// running any infrastructure at all.
///
/// It also means losing the phone loses the work, and the screen says so rather
/// than letting somebody find out.
struct ProjectsScreen: View {
    @ObservedObject var store: ProjectStore
    @ObservedObject var backup: Backup
    /// Whether this person has paid, so the list can offer the subscription and
    /// hand the answer to the correction screens.
    @ObservedObject var subscription: Subscription
    @ObservedObject var calendar: JobCalendar
    /// The whole stack, owned above this screen.
    ///
    /// It has to be, because finishing a capture does not *push* the review —
    /// it **replaces** the capture with it. Left as a push, the back button
    /// popped to the capture screen, whose `finished` was still set, and
    /// SwiftUI shoved the review straight back on: "no way to go back, always
    /// goes back into the scan project". A screen cannot take itself out of a
    /// stack it does not hold.
    @Binding var path: [Route]

    var body: some View {
        List {
            // Scan and Measure used to be the two rows at the top of this list.
            // They are tabs now, along the bottom where a thumb is, so they are
            // gone from here: two ways to start a scan, in two places, is two
            // things to keep in step and one of them to forget.
            if store.scans.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Nothing on this phone yet.")
                            .font(.headline)
                        Text(
                            ARMeasureSession.hasLiDAR
                            ? "Tap Scan along the bottom and walk a room — the phone finds the "
                              + "walls. Or tap Measure and put in the corners yourself."
                            : "This phone has no LiDAR, so it cannot scan. Tap Measure along "
                              + "the bottom and put in the corners yourself — every number in a "
                              + "room measured that way is measured from the first keystroke."
                        )
                        .font(.callout)
                        .foregroundStyle(Ink.quiet)
                    }
                    .padding(.vertical, 4)
                }
            } else {
                Section("On this phone") {
                    ForEach(store.scans) { entry in
                        // A capture with nothing in it IS a link now, and
                        // that is a reversal worth writing down.
                        //
                        // It used to be `.disabled`, because tapping one landed
                        // on a file picker with nothing on the phone to pick --
                        // a dead end. Disabling it made a different dead end:
                        // three rows on the list that could not be tapped, could
                        // not be opened, and offered nothing. "all those rooms
                        // when you get on the app, cant do anything with them,
                        // no options."
                        //
                        // A row nobody can touch is not a safe row, it is a row
                        // with no way out of it. So it opens a screen that says
                        // what happened and gives three: scan the room again,
                        // draw it by hand, or delete it.
                        NavigationLink(value: entry.hasRoom ? Route.open(entry) : Route.dead(entry)) {
                            HStack(spacing: 12) {
                                // The drawing, so the list shows the room
                                // rather than the timestamp. Three folders
                                // called "Room 2026-08-24 1819" told nobody
                                // which one was the kitchen.
                                Group {
                                    if let picture = entry.thumbnail,
                                       let data = try? Data(contentsOf: picture),
                                       let image = UIImage(data: data) {
                                        Image(uiImage: image)
                                            .resizable()
                                            .scaledToFit()
                                    } else {
                                        // A scan nobody has opened yet has no
                                        // drawing, because the drawing is made
                                        // by the screen that draws it. Say so
                                        // with an outline rather than a gap.
                                        Image(systemName: "square.dashed")
                                            .foregroundStyle(Ink.faint)
                                    }
                                }
                                .frame(width: 56, height: 56)
                                .background(Ink.sunk)
                                .clipShape(RoundedRectangle(cornerRadius: 6))

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(entry.name)
                                    if entry.hasRoom {
                                        Text(entry.kind)
                                            .font(.caption)
                                            .foregroundStyle(Ink.quiet)
                                    } else {
                                        Text(
                                            "No walls in this one — the capture did not "
                                            + "finish. Swipe to delete it, or scan the room "
                                            + "again."
                                        )
                                        .font(.caption)
                                        .foregroundStyle(Ink.scanned)
                                    }
                                }
                            }
                        }
                        // Every row, whether or not there is a room in it.
                        // Swipe-to-delete has existed since this list was
                        // written and is invisible until somebody guesses at
                        // it, which is not a way to offer the only action a row
                        // has.
                        .contextMenu {
                            if entry.hasRoom {
                                NavigationLink(value: Route.open(entry)) {
                                    Label("Open", systemImage: "square.and.pencil")
                                }
                                ShareLink(item: entry.folder) {
                                    Label("Share the whole scan", systemImage: "square.and.arrow.up")
                                }
                            } else {
                                NavigationLink(value: Route.dead(entry)) {
                                    Label("What went wrong", systemImage: "questionmark.circle")
                                }
                            }
                            Button(role: .destructive) {
                                forget(entry)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        // And visible without a long press. A context menu is
                        // still something you have to know is there.
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                forget(entry)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                    .onDelete { indexes in
                        // Through the same one place the menu and the swipe use,
                        // so all three cannot come apart -- and so none of them
                        // can ever forget the copy.
                        indexes.map { store.scans[$0] }.forEach(forget)
                    }
                }
            }

            Section {
                // What is true about the copy, said plainly, whichever way it
                // is. An app that quietly fails to back up is worse than one
                // that never claimed to, so "unavailable" gets as many words as
                // "up to date" and neither gets a tick it has not earned.
                switch backup.state {
                case .upToDate(let count, _):
                    Label(
                        (count.map { "\($0) scan\($0 == 1 ? "" : "s") copied" } ?? "Copied")
                        + " to your own iCloud. Not ours — yours. "
                        + "The drawings, not the photographs.",
                        systemImage: "checkmark.icloud"
                    )
                    .font(.footnote)
                    .foregroundStyle(Ink.quiet)
                case .working:
                    Label("Copying to your iCloud…", systemImage: "arrow.clockwise.icloud")
                        .font(.footnote)
                        .foregroundStyle(Ink.quiet)
                case .unavailable(let why):
                    Label(why, systemImage: "exclamationmark.icloud")
                        .font(.footnote)
                        .foregroundStyle(Ink.scanned)
                case .failed(let why):
                    Label(why, systemImage: "exclamationmark.icloud")
                        .font(.footnote)
                        .foregroundStyle(Ink.scanned)
                case .unknown:
                    EmptyView()
                }

                Text(
                    "Photographs stay on this phone. A scan's pictures are about 26 MB and a "
                    + "free iCloud account is 5 GB, so sending them up would fill somebody's "
                    + "iCloud with your job — that is a decision per job, not a default. "
                    + "Every scan is in the Files app under Trueline if you want to copy one off."
                )
                .font(.footnote)
                .foregroundStyle(Ink.quiet)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Ink.ground)
        .navigationTitle("Trueline")
        // One tap from the first screen of the app. It used to be a text link
        // at the top of a ROOM's page, so reading how to use the app required
        // already having scanned something with it.
        .toolbar { HandbookButton() }
        .navigationDestination(for: Route.self) { route in
            switch route {
            case .newScan:
                ScanScreen(store: store, backup: backup, onFinished: show)
            case .newMeasure:
                ARMeasureScreen(store: store, backup: backup, onFinished: show)
            case .open(let entry):
                if let scan = store.load(entry) {
                    ReviewScreen(scan: scan, store: store, backup: backup, subscription: subscription, calendar: calendar)
                } else {
                    Text("That capture could not be read. Its room.json or trace.json is missing.")
                        .padding()
                }
            case .review(let scan):
                ReviewScreen(scan: scan, store: store, backup: backup, subscription: subscription, calendar: calendar)
            case .dead(let entry):
                DeadCaptureScreen(
                    entry: entry,
                    store: store,
                    backup: backup,
                    subscription: subscription,
                    calendar: calendar,
                    path: $path
                )
            }
        }
        .onAppear { store.refresh() }
    }

    /// Forgetting a scan: off the phone, and out of the copy.
    ///
    /// Both halves, always. Deleting only the local folder means the next
    /// device to look puts the scan back, and somebody has to delete the same
    /// room twice and wonder which time counted.
    private func forget(_ entry: ProjectStore.Entry) {
        store.delete(entry)
        Task { await backup.forget(scan: entry.name) }
    }

    /// A finished capture takes the capture screen's place in the stack.
    ///
    /// One route in, one route out — so back from the review is back to this
    /// list, and there is no live camera screen left underneath waiting to push
    /// the review on again.
    private func show(_ scan: SavedScan) {
        store.refresh()
        path = [.review(scan)]
    }

    enum Route: Hashable {
        case newScan
        case newMeasure
        case open(ProjectStore.Entry)
        case review(SavedScan)
        /// A capture with no walls in it, and the three ways out of one.
        case dead(ProjectStore.Entry)
    }
}
