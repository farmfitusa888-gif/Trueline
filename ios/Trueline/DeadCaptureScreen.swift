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
///   - **Point at each corner** — needs no LiDAR, and every number in a room
///     walked that way is measured from the first tap. On a phone with no LiDAR
///     it is one of the two answers left, so it is offered first there.
///   - **Draw it on a grid** — no camera at all, for the room somebody cannot
///     get back into. Both of these used to be one button called "Draw it by
///     hand" that opened the camera, which was the wrong words for one of them
///     and no door at all for the other.
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
                        .foregroundStyle(Ink.scanned)
                    Text(
                        "This scan stopped before the phone had found a single wall, so the "
                        + "folder holds no room. Nothing in it can be recovered — there is no "
                        + "partial room in there to rescue."
                    )
                    .font(.callout)
                    .foregroundStyle(Ink.quiet)
                    Text(
                        "It usually means the capture was ended early, or the room was too dark "
                        + "for the phone to see where the walls met the floor. Walking it again "
                        + "slowly, with the lights on and standing back from each wall, is what "
                        + "fixes it."
                    )
                    .font(.callout)
                    .foregroundStyle(Ink.quiet)
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

                // Two different things, named for what they actually are.
                // Both of them used to be one button called "Draw it by hand",
                // and it opened the camera -- so somebody who wanted to tap a
                // room onto a grid got a live viewfinder and a reticle, and
                // somebody standing in a room they could not scan had no idea
                // one of these was a drawing screen.
                Button {
                    path = [.newMeasure]
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Point at each corner", systemImage: "ruler")
                        Text(
                            "Walk the room and tap each corner through the camera. Needs no "
                            + "LiDAR, and every number in it is measured from the first tap."
                        )
                        .font(.caption)
                        .foregroundStyle(Ink.quiet)
                    }
                }

                Button {
                    path = [.newDraw]
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Draw it on a grid", systemImage: "square.grid.3x3")
                        Text(
                            "Tap the corners onto a grid, then put the tape readings in. No "
                            + "camera at all — the way to do a room you cannot get back into."
                        )
                        .font(.caption)
                        .foregroundStyle(Ink.quiet)
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
                .foregroundStyle(Ink.quiet)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Ink.ground)
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
