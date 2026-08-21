import SwiftUI

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
    @State private var scanning = false

    var body: some View {
        List {
            Section {
                NavigationLink(value: Route.newScan) {
                    Label("Scan a room", systemImage: "camera.viewfinder")
                        .font(.headline)
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
                            VStack(alignment: .leading, spacing: 2) {
                                Text(entry.name)
                                if !entry.hasRoom {
                                    Text("No room in this one — the scan did not finish")
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                }
                            }
                        }
                    }
                    .onDelete { indexes in
                        indexes.map { store.scans[$0] }.forEach(store.delete)
                    }
                }
            }

            Section {
                Text(
                    "Scans are kept on this phone only. They are in the Files app under "
                    + "Trueline if you want to copy one off — nothing is uploaded anywhere."
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
            case .open(let entry):
                if let scan = store.load(entry) {
                    ReviewScreen(scan: scan)
                } else {
                    Text("That scan could not be read. Its room.json is missing or damaged.")
                        .padding()
                }
            }
        }
        .onAppear { store.refresh() }
    }

    enum Route: Hashable {
        case newScan
        case open(ProjectStore.Entry)
    }
}
