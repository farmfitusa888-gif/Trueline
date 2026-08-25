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
    @State private var scanning = false

    var body: some View {
        List {
            Section {
                NavigationLink(value: Route.newScan) {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Scan a room", systemImage: "camera.viewfinder")
                            .font(.headline)
                        Text(
                            ARMeasureSession.hasLiDAR
                            ? "Walk it and the phone finds the walls"
                            : "Needs LiDAR — this phone does not have it"
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }
                .disabled(!ARMeasureSession.hasLiDAR)

                NavigationLink(value: Route.newMeasure) {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Measure a room", systemImage: "ruler")
                            .font(.headline)
                        Text("Tap each corner. Works on any phone.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if store.scans.isEmpty {
                Section {
                    Text("Nothing scanned yet. Walk a room and it appears here.")
                        .foregroundStyle(.secondary)
                }
            } else {
                Section("On this phone") {
                    ForEach(store.scans) { entry in
                        NavigationLink(value: Route.open(entry)) {
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
                                            .foregroundStyle(.tertiary)
                                    }
                                }
                                .frame(width: 56, height: 56)
                                .background(Color(.secondarySystemBackground))
                                .clipShape(RoundedRectangle(cornerRadius: 6))

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(entry.name)
                                    if entry.hasRoom {
                                        Text(entry.kind)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    } else {
                                        Text("Nothing in this one — the capture did not finish")
                                            .font(.caption)
                                            .foregroundStyle(.orange)
                                    }
                                }
                            }
                        }
                    }
                    .onDelete { indexes in
                        let going = indexes.map { store.scans[$0] }
                        going.forEach(store.delete)
                        // And the copy. Leaving it would mean the next device
                        // to look puts the scan back, and somebody has to
                        // delete the same room twice.
                        Task {
                            for entry in going { await backup.forget(scan: entry.name) }
                        }
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
                    .foregroundStyle(.secondary)
                case .working:
                    Label("Copying to your iCloud…", systemImage: "arrow.clockwise.icloud")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                case .unavailable(let why):
                    Label(why, systemImage: "exclamationmark.icloud")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                case .failed(let why):
                    Label(why, systemImage: "exclamationmark.icloud")
                        .font(.footnote)
                        .foregroundStyle(.orange)
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
                .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Trueline")
        .navigationDestination(for: Route.self) { route in
            switch route {
            case .newScan:
                ScanScreen(store: store)
            case .newMeasure:
                ARMeasureScreen(store: store)
            case .open(let entry):
                if let scan = store.load(entry) {
                    ReviewScreen(scan: scan, store: store, backup: backup)
                } else {
                    Text("That capture could not be read. Its room.json or trace.json is missing.")
                        .padding()
                }
            }
        }
        .onAppear { store.refresh() }
    }

    enum Route: Hashable {
        case newScan
        case newMeasure
        case open(ProjectStore.Entry)
    }
}
