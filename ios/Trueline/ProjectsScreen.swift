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
    /// True while the iCloud look-up below is in flight, so its button says so
    /// rather than looking dead on a slow connection.
    ///
    /// Named for what it is asking. `looking` was taken -- it is the search
    /// box's text, thirty lines further down -- and reusing it did not fail
    /// until the compiler said so on Sam's Mac.
    @State private var askingICloud = false
    /// True while the Files picker is up.
    @State private var picking = false
    /// What the last import did, in words. Shown until it is dismissed, because
    /// "nothing happened" is the one answer an import must never give.
    @State private var brought: String?
    /// Whether this person has paid, so the list can offer the subscription and
    /// hand the answer to the correction screens.
    @ObservedObject var subscription: Subscription
    @ObservedObject var calendar: JobCalendar
    /// Passed straight through to `ReviewScreen`, which is where the web
    /// view that can throw actually lives.
    @ObservedObject var diagnostics: Diagnostics
    /// The whole stack, owned above this screen.
    ///
    /// It has to be, because finishing a capture does not *push* the review —
    /// it **replaces** the capture with it. Left as a push, the back button
    /// popped to the capture screen, whose `finished` was still set, and
    /// SwiftUI shoved the review straight back on: "no way to go back, always
    /// goes back into the scan project". A screen cannot take itself out of a
    /// stack it does not hold.
    @Binding var path: [Route]

    /// What somebody is looking for. Matched against the room's name, its job
    /// and how it was captured, so "willow", "kitchen" and "drawn" all find
    /// something.
    @State private var looking = ""
    /// Whether finished work is on screen. Off by default — that is the whole
    /// point of archiving it.
    @State private var showingArchived = false
    /// The room being renamed or filed, and the text being typed for it.
    @State private var editing: ProjectStore.Entry?
    @State private var typedName = ""
    @State private var typedJob = ""
    /// Said when a card could not be written, which on a phone means the disk
    /// is full. A rename that silently did not happen is worse than one that
    /// failed out loud.
    @State private var trouble: String?
    /// Whether the subscription sheet is up.
    ///
    /// `PaywallView` compiled, was in the target, and **nothing in the app ever
    /// presented it** -- `grep -rn PaywallView ios/ --include=*.swift` returned
    /// its own declaration and nothing else. Every gate in the app therefore
    /// refused without offering a way to buy: a lost sale on every one of them,
    /// and, the day the app goes on sale, a 3.1.1 rejection for having a paid
    /// tier with no purchase path. This is the way in.
    @State private var showingPaywall = false

    /// The rooms to show, after the search box and the archive switch.
    private var showing: [ProjectStore.Entry] {
        let wanted = looking.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return store.scans.filter { entry in
            if entry.card.archived != showingArchived { return false }
            guard !wanted.isEmpty else { return true }
            return entry.title.lowercased().contains(wanted)
                || entry.card.job.lowercased().contains(wanted)
                || entry.kind.lowercased().contains(wanted)
        }
    }

    /// The jobs on screen, most recently touched first, with the unfiled last.
    ///
    /// `store.scans` is already newest-first, so the order a job first appears
    /// in it is the order of its newest room — which is the order somebody
    /// wants: the house they were at this morning at the top.
    private var grouped: [(job: String, rooms: [ProjectStore.Entry])] {
        var order: [String] = []
        var byJob: [String: [ProjectStore.Entry]] = [:]
        for entry in showing {
            let job = entry.card.job
            if byJob[job] == nil { order.append(job) }
            byJob[job, default: []].append(entry)
        }
        // The unfiled go last, whenever they turned up: they are the ones that
        // still need a decision, and a decision belongs at the bottom of a list
        // rather than on top of the work.
        return order
            .sorted { a, b in
                if a.isEmpty != b.isEmpty { return !a.isEmpty }
                return (order.firstIndex(of: a) ?? 0) < (order.firstIndex(of: b) ?? 0)
            }
            .map { (job: $0, rooms: byJob[$0] ?? []) }
    }

    private var archivedCount: Int { store.scans.filter(\.card.archived).count }

    var body: some View {
        List {
            // Scan and Measure used to be the two rows at the top of this list.
            // They are tabs now, along the bottom where a thumb is, so they are
            // gone from here: two ways to start a scan, in two places, is two
            // things to keep in step and one of them to forget.
            //
            // Drawing is the third way in and it is NOT a tab, because iOS
            // folds anything past the fifth tab into a "More" list and five are
            // spent. So it is a row, here, on the first screen of the app --
            // permanently, not only when the list is empty. Until this row
            // existed the grid in `Sketch.tsx` could be reached exactly one
            // way: start a scan, fail it, open the dead capture, and take a way
            // out. A way out is not a way in.
            Section {
                // Bringing one back in. A scan is a folder, which is what makes
                // it possible to AirDrop one or text one to yourself -- and
                // until this row there was no way to get one BACK except moving
                // a folder into On My iPhone → Trueline → Scans by hand, with
                // the nesting exactly right. An export with no import is half a
                // feature.
                Button {
                    picking = true
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Bring a room in from Files", systemImage: "square.and.arrow.down")
                        Text(
                            "Unzip it first if it arrived as a zip. Then open the scan's "
                            + "folder, tap Select, Select All, and Open — the room and its "
                            + "photographs come in together."
                        )
                        .font(.caption)
                        .foregroundStyle(Ink.quiet)
                    }
                }

                NavigationLink(value: Route.newDraw) {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Draw a room", systemImage: "square.grid.3x3")
                        Text(
                            "Tap the corners onto a grid. No camera, no LiDAR, no scan — the "
                            + "way to price a room off an old drawing, or one you cannot get "
                            + "into."
                        )
                        .font(.caption)
                        .foregroundStyle(Ink.quiet)
                    }
                }
            }

            // The example and the tour.
            //
            // Everything this app is worth showing somebody happens after a
            // scan, and a scan needs a LiDAR phone, a room and ten minutes. So
            // an empty first screen was the whole first impression: a list with
            // nothing in it and an instruction to go and find a kitchen.
            //
            // These two rows are the answer, and they are permanent rather than
            // only shown while the list is empty — the takeoff workings and the
            // change-order screen are worth a second look long after somebody
            // has scanned their first room.
            Section {
                NavigationLink(value: Route.tour) {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Take the tour", systemImage: "figure.walk.motion")
                        Text(
                            "Every screen in the app, over a finished kitchen, in the order "
                            + "of a job — the drawing, the takeoff, the price, the proposal, "
                            + "the signature, the claim and the files. Nothing on your phone "
                            + "is touched."
                        )
                        .font(.caption)
                        .foregroundStyle(Ink.quiet)
                    }
                }
                NavigationLink(value: Route.example) {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Open the worked example", systemImage: "doc.text.magnifyingglass")
                        Text(
                            "The same kitchen, without the tour. Scanned, taped on two walls, "
                            + "priced, written up, signed and invoiced."
                        )
                        .font(.caption)
                        .foregroundStyle(Ink.quiet)
                    }
                }
            }

            if store.scans.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Nothing on this phone yet.")
                            .font(.headline)
                        Text(
                            ARMeasureSession.hasLiDAR
                            ? "Tap Scan along the bottom and walk a room — the phone finds the "
                              + "walls. Or tap Measure and point at each corner. Or draw one "
                              + "above, with no camera at all."
                            : "This phone has no LiDAR, so it cannot scan. Tap Measure along "
                              + "the bottom and point at each corner — every number in a room "
                              + "measured that way is measured from the first keystroke. Or "
                              + "draw one above, with no camera at all."
                        )
                        .font(.callout)
                        .foregroundStyle(Ink.quiet)
                    }
                    .padding(.vertical, 4)
                }
            } else if showing.isEmpty && !looking.isEmpty {
                Section {
                    Text("Nothing here matches \"\(looking)\".")
                        .font(.callout)
                        .foregroundStyle(Ink.quiet)
                }
            } else if showing.isEmpty && showingArchived {
                Section {
                    Text("Nothing has been archived yet. Finish a job and put it away here.")
                        .font(.callout)
                        .foregroundStyle(Ink.quiet)
                }
            } else {
                ForEach(grouped, id: \.job) { group in
                Section(
                    group.job.isEmpty
                        ? (showingArchived ? "Archived" : "Not in a job yet")
                        : group.job
                ) {
                    ForEach(group.rooms) { entry in
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
                                    // What somebody called it, not when it was
                                    // captured. Every row on this list used to
                                    // read "Room 2026-08-26 0927" -- including
                                    // the rooms that had been renamed, because
                                    // the name went into `corrected.json` and
                                    // nothing here ever read it.
                                    Text(entry.title)
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
                            Button {
                                editing = entry
                                typedName = entry.title
                                typedJob = entry.card.job
                            } label: {
                                Label("Rename or file it", systemImage: "pencil")
                            }
                            Button {
                                if !store.archive(entry, !entry.card.archived) {
                                    trouble = "That could not be written. The phone may be out "
                                        + "of space — the room itself is untouched."
                                }
                            } label: {
                                entry.card.archived
                                    ? Label("Put it back on the list", systemImage: "tray.and.arrow.up")
                                    : Label("Archive it", systemImage: "archivebox")
                            }
                            Button(role: .destructive) {
                                forget(entry)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        // And visible without a long press. A context menu is
                        // still something you have to know is there.
                        .swipeActions(edge: .leading) {
                            Button {
                                if !store.archive(entry, !entry.card.archived) {
                                    trouble = "That could not be written. The phone may be out "
                                        + "of space — the room itself is untouched."
                                }
                            } label: {
                                entry.card.archived
                                    ? Label("Put back", systemImage: "tray.and.arrow.up")
                                    : Label("Archive", systemImage: "archivebox")
                            }
                            .tint(Ink.accent)
                        }
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
                        // can ever forget the copy. Indexed into THIS group's
                        // rooms, not into `store.scans`: the list is grouped
                        // now, and indexing the wrong array deletes the wrong
                        // room.
                        indexes.map { group.rooms[$0] }.forEach(forget)
                    }
                }
                }
            }

            Section {
                Button {
                    showingPaywall = true
                } label: {
                    // Three different true sentences, because there are three
                    // different situations and one wording for all of them
                    // would be untrue in two.
                    if Subscription.freeUntilLaunch {
                        Label(
                            "Everything is on, free, until Trueline reaches the App Store. "
                            + "See what it will cost.",
                            systemImage: "gift"
                        )
                    } else if subscription.subscribed {
                        Label("Your subscription", systemImage: "checkmark.seal")
                    } else {
                        Label("Subscribe to Trueline", systemImage: "lock.open")
                    }
                }
                .font(.footnote)
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

                // Bring rooms back, on purpose, and say what happened.
                //
                // This has always run at launch. It ran silently, so a room
                // deleted by accident and not restored looked identical to
                // three different problems: no copy in iCloud, a query iCloud
                // refused, and a restore that worked and found nothing missing.
                // A recovery path nobody can watch is one nobody can trust.
                Button {
                    Task { await lookForRooms() }
                } label: {
                    Label(
                        askingICloud ? "Asking iCloud…" : "Look for rooms in iCloud",
                        systemImage: "arrow.down.circle"
                    )
                }
                .disabled(askingICloud)

                if let said = backup.lastRestore {
                    Text(said)
                        .font(.footnote)
                        .foregroundStyle(Ink.quiet)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Ink.ground)
        // One box, matched against the name, the job and how it was captured.
        // Twenty rooms in one scrolling list, newest first, was the only order
        // there had ever been.
        .searchable(text: $looking, prompt: "Find a room or a job")
        .navigationTitle("Trueline")
        // One tap from the first screen of the app. It used to be a text link
        // at the top of a ROOM's page, so reading how to use the app required
        // already having scanned something with it.
        .toolbar {
            // Finished work, and the way back to it. Only offered once there is
            // some: a control for an empty shelf is a control that teaches
            // somebody the app has a shelf they do not need.
            if archivedCount > 0 || showingArchived {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showingArchived.toggle()
                    } label: {
                        Label(
                            showingArchived ? "The current work" : "Archived (\(archivedCount))",
                            systemImage: showingArchived ? "tray.full" : "archivebox"
                        )
                        .labelStyle(.titleAndIcon)
                        .font(.footnote)
                    }
                }
            }
            HandbookButton()
        }
        // The subscription, reachable from the first screen of the app rather
        // than only from whatever refused. A person who has just been told they
        // cannot do something needs somewhere to go, and until now there was
        // nowhere.
        .sheet(isPresented: $showingPaywall) {
            PaywallView(
                subscription: subscription,
                // Nothing in particular was tapped to get here, so the sheet
                // opens on the subscription itself rather than pretending to
                // know which feature somebody wanted.
                asking: nil,
                onClose: { showingPaywall = false }
            )
        }
        // Renaming and filing, in one sheet, because they are the same thought:
        // what is this and whose is it.
        .sheet(item: $editing) { entry in
            NavigationStack {
                Form {
                    Section("What is this room?") {
                        TextField("Kitchen", text: $typedName)
                    }
                    Section {
                        TextField("118 Willow St", text: $typedJob)
                        // Picked rather than typed again, so the second room of
                        // a house lands in the same job as the first instead of
                        // in a job spelled slightly differently.
                        ForEach(store.jobs().filter { $0 != typedJob }, id: \.self) { job in
                            Button(job) { typedJob = job }
                        }
                    } header: {
                        Text("Which job")
                    } footer: {
                        Text(
                            "The property this room is part of. Leave it empty and the room sits "
                            + "on its own. The folder on this phone keeps its own name and does "
                            + "not move — the name here is a label, and moving a folder is how a "
                            + "backup ends up pointing at nothing."
                        )
                    }
                }
                .navigationTitle(entry.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { editing = nil }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            let named = store.rename(entry, to: typedName)
                            let filed = store.file(entry, under: typedJob)
                            if !named || !filed {
                                trouble = "That could not be written. The phone may be out of "
                                    + "space — the room itself is untouched."
                            }
                            editing = nil
                        }
                    }
                }
            }
        }
        .alert(
            "That could not be saved",
            isPresented: .init(get: { trouble != nil }, set: { if !$0 { trouble = nil } })
        ) {
            Button("All right", role: .cancel) { trouble = nil }
        } message: {
            Text(trouble ?? "")
        }
        .fileImporter(
            isPresented: $picking,
            // A folder is the whole scan -- the room, the card, the
            // photographs, the USDZ. A bare JSON is the room on its own, which
            // is what somebody has when a zip was unpacked badly.
            allowedContentTypes: [.folder, .json, .image],
            // Many, because iOS will not let you SELECT a folder -- tapping one
            // opens it. Selecting every file inside a folder is easy: Select,
            // Select All, Open. `bringIn` puts them back where they belong.
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .failure(let why):
                brought = why.localizedDescription
            case .success(let picked):
                guard !picked.isEmpty else { return }
                switch store.bringIn(picked) {
                case .took(let name):
                    brought = "\(name) is on this phone now."
                case .alreadyHere(let name):
                    brought = "There is already a room called \(name) here, so nothing was "
                        + "changed. Rename the one you have if you want both."
                case .notARoom(let why):
                    brought = why
                }
            }
        }
        .alert("Bringing a room in", isPresented: .constant(brought != nil)) {
            Button("All right", role: .cancel) { brought = nil }
        } message: {
            Text(brought ?? "")
        }
        .navigationDestination(for: Route.self) { route in
            switch route {
            case .newScan:
                // Pushed, from "scan it again" on a capture with no walls in
                // it. Here there really is something to close, and closing it
                // is a pop back to this list.
                ScanScreen(
                    store: store,
                    backup: backup,
                    onFinished: show,
                    onClose: { path = [] }
                )
            case .newMeasure:
                ARMeasureScreen(store: store, backup: backup, onFinished: show)
            case .example:
                WebScreen(
                    opensOn: .demo,
                    title: "Worked example",
                    store: store,
                    backup: backup
                )
            case .tour:
                WebScreen(
                    opensOn: .tour,
                    title: "Guided tour",
                    store: store,
                    backup: backup
                )
            case .newDraw:
                // Same contract as the other two ways in: it makes a room, and
                // the room takes this screen's place in the stack rather than
                // sitting on top of it.
                DrawScreen(
                    store: store,
                    backup: backup,
                    diagnostics: diagnostics,
                    onFinished: show
                )
            case .open(let entry):
                if let scan = store.load(entry) {
                    ReviewScreen(
                        scan: scan, store: store, backup: backup,
                        subscription: subscription, calendar: calendar, diagnostics: diagnostics,
                        // Appended rather than replacing, so Back from the
                        // marking pass is the room it was opened from.
                        onMarkAgain: { path.append(.markAgain(scan)) }
                    )
                } else {
                    Text("That capture could not be read. Its room.json or trace.json is missing.")
                        .padding()
                }
            case .review(let scan):
                ReviewScreen(
                    scan: scan, store: store, backup: backup,
                    subscription: subscription, calendar: calendar, diagnostics: diagnostics,
                    onMarkAgain: { path.append(.markAgain(scan)) }
                )
            case .markAgain(let scan):
                // The same camera and the same Mark button, and nothing
                // RoomPlan builds is kept -- see `ScanModel.markingInto`. The
                // pins and photographs are merged into this room's own folder,
                // and finishing lands back on the room with them in it.
                ScanScreen(
                    store: store,
                    backup: backup,
                    onFinished: show,
                    onClose: { if !path.isEmpty { path.removeLast() } },
                    markingInto: scan.folder
                )
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
    /// Ask iCloud for anything this phone does not have, and write it down.
    ///
    /// The same call the app makes at launch, on a button, so it can be run
    /// when it is actually needed — which is the moment somebody notices a room
    /// is gone, not the moment the app happened to start.
    @MainActor
    private func lookForRooms() async {
        askingICloud = true
        defer { askingICloud = false }
        await backup.check()
        for scan in await backup.fetchMissing(have: store.names) {
            store.restore(
                name: scan.name, capture: scan.capture, kind: scan.kind,
                card: scan.card, corrected: scan.corrected
            )
            let folder = store.folder(named: scan.name)
            for photo in await backup.fetchDamagePhotos(scan: scan.name) {
                store.writeDamagePhoto(photo.jpeg, named: photo.name, into: folder)
            }
        }
        store.refresh()
    }

    private func show(_ scan: SavedScan) {
        store.refresh()
        path = [.review(scan)]
    }

    enum Route: Hashable {
        case newScan
        case newMeasure
        /// The grid, for a room drawn rather than captured.
        case newDraw
        case open(ProjectStore.Entry)
        case review(SavedScan)
        /// A capture with no walls in it, and the three ways out of one.
        case dead(ProjectStore.Entry)
        /// The camera again, for marks only, over a room that already exists.
        case markAgain(SavedScan)
        /// A finished job to look at, and a guided tour over the top of it.
        /// Neither touches this phone's rooms: the example is a file in the
        /// bundle, and the tour only moves between screens.
        case example
        case tour
    }
}
