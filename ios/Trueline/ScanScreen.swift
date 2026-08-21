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
    @Environment(\.dismiss) private var dismiss

    init(store: ProjectStore) {
        _model = StateObject(wrappedValue: ScanModel(store: store))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            CaptureViewport(session: model.session)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                if let instruction = model.session.instruction, model.session.isRunning {
                    Text(instruction)
                        .font(.headline)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.top, 12)
                }
                Spacer()
                measurements
                controls
            }
        }
        .alert("That did not work", isPresented: model.showingFailure) {
            Button("Close", role: .cancel) {}
        } message: {
            Text(model.session.failure ?? "")
        }
        .navigationBarBackButtonHidden(model.session.isRunning)
        .onAppear { model.begin() }
        .onDisappear { model.session.stop() }
        .navigationDestination(item: $model.finished) { scan in
            ReviewScreen(scan: scan)
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

/// RoomPlan's own view, which draws the room as it is found and runs the
/// coaching overlay. Rebuilding that would be work for a worse result.
private struct CaptureViewport: UIViewRepresentable {
    let session: ScanSession

    func makeUIView(context: Context) -> RoomCaptureView { session.captureView }
    func updateUIView(_ view: RoomCaptureView, context: Context) {}
}
