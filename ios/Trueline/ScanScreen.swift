import RoomPlan
import SwiftUI
import UIKit

/// The scan itself: what the camera sees, what it has measured so far, and a
/// shutter.
///
/// The live measurements are the point of this screen. Every other scanner shows
/// you a mesh growing and tells you the numbers afterwards, at a desk, where
/// disagreeing with one means going back to the house. Here the lengths are on
/// screen while the person is standing in front of the wall — so the moment to
/// notice that a wall reads 11'7" when it is plainly twelve foot is the moment
/// they can still put a tape on it.
struct ScanScreen: View {

    @StateObject private var model: ScanModel
    /// The way out when the scan is over and nothing was saved.
    ///
    /// This was being *called* without being declared, which is a compile
    /// error rather than a subtle one: "cannot find 'dismiss' in scope". The
    /// Swift parse check in `core/tools/check-swift.py` cannot see it -- the
    /// file parses perfectly, it just names something that does not exist --
    /// which is a good reminder that a parser is not a compiler.
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ProjectStore
    @ObservedObject var backup: Backup
    /// Handed the finished scan, so the screen holding the stack can put the
    /// review in this screen's place rather than on top of it.
    let onFinished: (SavedScan) -> Void

    init(store: ProjectStore, backup: Backup, onFinished: @escaping (SavedScan) -> Void) {
        self.store = store
        self.backup = backup
        self.onFinished = onFinished
        _model = StateObject(wrappedValue: ScanModel(store: store))
    }

    /// Whether a tap on the picture marks damage or does nothing.
    ///
    /// Off by default, and that is not timidity. RoomPlan's own view is the
    /// thing under the finger and it is walked with the phone held out at arm's
    /// length -- a screen where every accidental brush drops a pin would leave
    /// somebody with eleven pins called "" and a scan they have to redo. So
    /// marking is a mode, it says on screen that it is on, and it turns itself
    /// off the moment a pin is kept.
    @State private var marking = false
    @State private var saying = ""
    @State private var kind = "water"

    /// The damage kinds, as `core/src/damage.ts` names them. Its words, not a
    /// second list that can drift out of step with the first.
    private static let kinds: [(id: String, label: String)] = [
        ("water", "Water"), ("mould", "Mould"), ("fire", "Fire"), ("smoke", "Smoke"),
        ("impact", "Impact"), ("wind", "Wind"), ("other", "Other"),
    ]

    var body: some View {
        ZStack(alignment: .bottom) {
            CaptureViewport(session: model.session)
                .ignoresSafeArea()

            // The tap target, over the picture and under the controls. Only
            // there while marking is on, so an ordinary walk is unchanged and
            // RoomPlan's own gestures are untouched the rest of the time.
            if marking {
                GeometryReader { geometry in
                    Color.clear
                        .contentShape(Rectangle())
                        // The overload that hands back WHERE it was tapped.
                        // The bare `onTapGesture { }` takes no argument, and a
                        // pin needs the point or it has nothing to cast a ray
                        // through.
                        .onTapGesture(coordinateSpace: .local) { spot in
                            model.session.markWhereTapped(
                                at: spot,
                                in: geometry.size,
                                orientation: Self.orientation()
                            )
                            if model.session.pending != nil {
                                UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
                            }
                        }
                }
                .ignoresSafeArea()
                .accessibilityLabel("Point at the damage and tap")
            }

            VStack(spacing: 0) {
                if let instruction = model.session.instruction, model.session.isRunning {
                    Text(instruction)
                        .font(.headline)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.top, 12)
                }
                if marking {
                    Text("Point at the damage and tap it")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(.red.opacity(0.85), in: Capsule())
                        .foregroundStyle(.white)
                        .padding(.top, 8)
                }
                if let trouble = model.session.pinTrouble {
                    Text(trouble)
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
                        .padding(.horizontal, 24)
                        .padding(.top, 8)
                }
                Spacer()
                measurements
                controls
            }
        }
        .sheet(isPresented: sayingWhatItIs) { whatIsIt }
        .alert("That did not work", isPresented: model.showingFailure) {
            Button("Close", role: .cancel) {}
        } message: {
            Text(model.session.failure ?? "")
        }
        .navigationBarBackButtonHidden(model.session.isRunning)
        .onAppear { model.begin() }
        .onDisappear { model.session.stop() }
        .onChange(of: model.finished) { _, scan in
            guard let scan else { return }
            onFinished(scan)
        }
    }

    /// What has been measured so far, longest first.
    ///
    /// Longest first because that is the wall most worth disagreeing with: an
    /// error on it costs the most floor area, which is the same reason the punch
    /// list ranks that way.
    private var measurements: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(model.session.walls.sorted { $0.lengthMetres > $1.lengthMetres }) { wall in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(Formatting.feetInches(metres: wall.lengthMetres))
                            .font(.system(.title3, design: .rounded).weight(.semibold))
                            .monospacedDigit()
                        Text(wall.confidence)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
                }
            }
            .padding(.horizontal, 16)
        }
        .frame(height: model.session.walls.isEmpty ? 0 : 64)
        .opacity(model.session.walls.isEmpty ? 0 : 1)
    }

    private var controls: some View {
        VStack(spacing: 12) {
            // Named while walking rather than afterwards, because afterwards is
            // three rooms later and they are all called Room.
            TextField("What is this room?", text: $model.name)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.done)
                .padding(.horizontal, 20)

            shutterRow
        }
        .padding(.vertical, 16)
        .background(.ultraThinMaterial)
    }

    private var shutterRow: some View {
        HStack(spacing: 20) {
            Text("\(model.session.photoCount) photos")
                .font(.footnote)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)

            // The shutter. Automatic photographs happen anyway; this is for the
            // thing somebody noticed and wants on the record.
            Button {
                model.session.takePhoto(trigger: .manual)
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            } label: {
                Circle()
                    .strokeBorder(.white, lineWidth: 4)
                    .frame(width: 66, height: 66)
                    .background(Circle().fill(.white.opacity(0.25)))
            }
            .disabled(!model.session.isRunning)

            // Marking, beside the shutter rather than buried: the moment to
            // record the stain is while standing in front of it, and a control
            // for that which takes two taps to find will not be used.
            Button {
                marking.toggle()
                model.session.pinTrouble = nil
            } label: {
                VStack(spacing: 2) {
                    Image(systemName: marking ? "mappin.circle.fill" : "mappin.circle")
                        .font(.title2)
                    Text(model.session.pinCount == 0 ? "Mark" : "\(model.session.pinCount) marked")
                        .font(.caption2)
                        .monospacedDigit()
                }
                .foregroundStyle(marking ? .red : .primary)
            }
            .accessibilityLabel(marking ? "Stop marking damage" : "Mark damage")
            .disabled(!model.session.isRunning)

            Button(model.session.isRunning ? "Done" : "Close") {
                if model.session.isRunning {
                    model.finish()
                } else {
                    dismiss()
                }
            }
            .font(.headline)
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 20)
    }
}

extension ScanScreen {

    /// Open while a tap is waiting for words.
    ///
    /// A binding rather than a `@State` flag, because what decides it is the
    /// session holding a pending tap. Two sources of truth for "is the sheet
    /// up" is a sheet that stays up after the pin is written.
    private var sayingWhatItIs: Binding<Bool> {
        Binding(
            get: { model.session.pending != nil },
            set: { if !$0 { model.session.forgetPending() } }
        )
    }

    /// What the thing that was just tapped actually is.
    ///
    /// Asked immediately, on the spot, and that is the whole design. Every
    /// competitor's answer to "record the damage" is a photograph, and a
    /// photograph taken in a basement is a rectangle of grey that means nothing
    /// three days later. Six words typed while standing in front of it are
    /// worth more than the picture, and they are only ever going to be typed
    /// here -- nobody goes back through ninety photographs at a desk.
    @ViewBuilder
    private var whatIsIt: some View {
        NavigationStack {
            Form {
                Section("What is it") {
                    Picker("Kind", selection: $kind) {
                        ForEach(Self.kinds, id: \.id) { one in
                            Text(one.label).tag(one.id)
                        }
                    }
                    .pickerStyle(.menu)

                    TextField("Staining behind the boiler", text: $saying, axis: .vertical)
                        .lineLimit(2...4)
                        .submitLabel(.done)
                }

                if let waiting = model.session.pending, waiting.found == .planeInfinite {
                    Section {
                        Text(
                            "The phone put this on the plane of a wall it has not finished "
                            + "mapping, so how far along that wall it sits is worked out rather "
                            + "than seen. Scan across the spot and mark it again if it matters."
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                }

                if let trouble = model.session.pinTrouble {
                    Section { Text(trouble).font(.footnote).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Mark the damage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Throw it away") {
                        model.session.forgetPending()
                        saying = ""
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Mark it") {
                        model.session.keep(kind: kind, note: saying)
                        if model.session.pending == nil {
                            saying = ""
                            // Marking turns itself off after a pin is kept.
                            // Leaving it on is how somebody walking with the
                            // phone out ends up with pins they never meant.
                            marking = false
                        }
                    }
                    .disabled(saying.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }

    /// Which way up the phone is, for the raycast.
    ///
    /// ARKit hands back every frame in the sensor's landscape frame whatever
    /// way the phone is being held, and `displayTransform` needs to be told
    /// which way that is. Read off the active scene rather than assumed:
    /// assuming portrait is right for every scan anybody does and wrong for the
    /// one person who turns the phone sideways, and being wrong here puts the
    /// pin somewhere else entirely.
    static func orientation() -> UIInterfaceOrientation {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
        return scene?.interfaceOrientation ?? .portrait
    }
}

/// RoomPlan's own view, which draws the room as it is found and runs the
/// coaching overlay. Rebuilding that would be work for a worse result.
private struct CaptureViewport: UIViewRepresentable {
    let session: ScanSession

    func makeUIView(context: Context) -> RoomCaptureView { session.captureView }
    func updateUIView(_ view: RoomCaptureView, context: Context) {}
}
