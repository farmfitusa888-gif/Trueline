import SwiftUI

/// A capture with no walls in it, and the three ways out of one.
///
/// ## The dead end this replaces, and the dead end before that
///
/// A scan stopped before the phone found a wall writes a folder with nothing
/// openable in it. That happens — somebody backs out of the capture, the room
/// is too dark, the phone is put down. It is not rare and it is not a bug.
///
/// The first version of the list let you tap one anyway. You got "The scan has
/// no walls" and landed on a file picker with nothing on the phone to pick.
/// That was fixed by making the row `.disabled`, which fixed the wrong half:
///
/// > "all those rooms when you get on the app, cant do anything with them, no
/// > options"
///
/// Exactly right. A row nobody can touch is not a safe row — it is a row with
/// no way out of it, sitting on the first screen of the app, three times over.
///
/// So the row opens this, and this says what happened in plain words and offers
/// the only three things anybody would want:
///
///   - **Scan the room again** — the usual answer, and it is one tap away.
///   - **Draw it by hand** — needs no LiDAR, and every number in a room drawn
///     that way is measured from the first keystroke. On a phone with no LiDAR
///     it is the *only* answer, so it is offered first there.
///   - **Delete it** — off the phone and out of the iCloud copy, both, so the
///     next device to look does not put it back.
///
/// ## What it will not do
///
/// It will not pretend anything can be recovered. There is no room in the file,
/// there is no partial room in the file, and offering to "try again" on the
/// bytes would be offering something that cannot work.
struct DeadCaptureScreen: View {
    let entry: ProjectStore.Entry
    @ObservedObject var store: ProjectStore
    @ObservedObject var backup: Backup
    @ObservedObject var subscription: Subscription
    @ObservedObject var calendar: JobCalendar
    @Binding var path: [ProjectsScreen.Route]
    @Environment(\.dismiss) private var dismiss
    @State private var confirming = false

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Nothing was captured", systemImage: "exclamationmark.triangle")
                        .font(.headline)
                        .foregroundStyle(.orange)
                    Text(
                        "This scan stopped before the phone had found a single wall, so the "
                        + "folder holds no room. Nothing in it can be recovered — there is no "
                        + "partial room in there to rescue."
                    )
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    Text(
                        "It usually means the capture was ended early, or the room was too dark "
                        + "for the phone to see where the walls met the floor. Walking it again "
                        + "slowly, with the lights on and standing back from each wall, is what "
                        + "fixes it."
                    )
                    .font(.callout)
                    .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }

            Section("What you can do about it") {
                // On a phone with LiDAR, scanning again is the usual answer and
                // goes first. On one without, it is not an answer at all and is
                // not offered -- a button that cannot work is worse than no
                // button, which is the whole lesson of the row that opened this
                // screen.
                if ARMeasureSession.hasLiDAR {
                    Button {
                        path = [.newScan]
                    } label: {
                        Label("Scan the room again", systemImage: "camera.viewfinder")
                    }
                }

                Button {
                    path = [.newMeasure]
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Draw it by hand", systemImage: "ruler")
                        Text(
                            "Put in the corners yourself. Needs no LiDAR, and every number in "
                            + "it is measured from the first keystroke."
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }

                Button(role: .destructive) {
                    confirming = true
                } label: {
                    Label("Delete this capture", systemImage: "trash")
                }
            }

            Section {
                Text(
                    "Saved \(entry.modified.formatted(date: .abbreviated, time: .shortened)). "
                    + "The folder is in the Files app under Trueline if you want to look at it "
                    + "before it goes."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
        .navigationTitle(entry.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { HandbookButton() }
        .confirmationDialog(
            "Delete this capture?",
            isPresented: $confirming,
            titleVisibility: .visible
        ) {
            Button("Delete it", role: .destructive) {
                store.delete(entry)
                // And the copy, or the next device to look puts it back and
                // somebody deletes the same empty folder twice.
                Task { await backup.forget(scan: entry.name) }
                dismiss()
            }
            Button("Keep it", role: .cancel) {}
        } message: {
            Text("There is no room in it, so nothing measured is lost. This cannot be undone.")
        }
    }
}
