import ARKit
import SwiftUI
import UIKit

/// Walking a room with no LiDAR.
///
/// One instruction at a time, because somebody is holding a phone at arm's
/// length in a room they are trying to price. Point, tap, walk, tap. When they
/// get back to where they started the app says so, and that closing tap is what
/// every dimension's band comes from.
struct ARMeasureScreen: View {

    @StateObject private var model: ARMeasureModel
    @ObservedObject var store: ProjectStore
    @ObservedObject var backup: Backup
    /// Handed the finished walk, so the screen holding the stack can put the
    /// review in this screen's place rather than on top of it.
    let onFinished: (SavedScan) -> Void

    init(store: ProjectStore, backup: Backup, onFinished: @escaping (SavedScan) -> Void) {
        self.store = store
        self.backup = backup
        self.onFinished = onFinished
        _model = StateObject(wrappedValue: ARMeasureModel(store: store))
    }

    var body: some View {
        // The reticle is in its own centred layer. It used to be inside the
        // bottom-aligned stack below, which drew it at the foot of the screen
        // behind the controls while the ray was cast from the middle — so
        // there was no aim point on screen at all, and the one thing this
        // screen is for was invisible.
        ZStack {
            ARViewport(session: model.session)
                .ignoresSafeArea()

            Reticle(ready: model.session.aimingAt != nil)

            VStack(spacing: 0) {
                Text(model.instruction)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .padding(.top, 12)
                    .padding(.horizontal, 20)

                Spacer()
                lengths
                controls
            }
            .frame(maxHeight: .infinity, alignment: .bottom)
        }
        .alert("That did not work", isPresented: model.showingFailure) {
            Button("Close", role: .cancel) { model.session.dismissFailure() }
        } message: {
            Text(model.session.failure ?? "")
        }
        .onAppear { model.begin() }
        .onDisappear { model.session.stop() }
        .onChange(of: model.finished) { _, scan in
            guard let scan else { return }
            onFinished(scan)
        }
    }

    private var floorControl: some View {
        FloorControl(
            from: model.session.floorFrom,
            height: model.session.heightAboveFloor,
            set: { model.session.setFloorFromDevice() },
            clear: { model.session.clearFloor() }
        )
        .padding(.horizontal, 20)
    }

    private var lengths: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(Array(model.session.edgeLengths.enumerated()), id: \.offset) { index, metres in
                    VStack(spacing: 2) {
                        Text(Formatting.feetInches(metres: metres))
                            .font(.system(.title3, design: .rounded).weight(.semibold))
                            .monospacedDigit()
                        Text("wall \(index + 1)")
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
        .frame(height: model.session.edgeLengths.isEmpty ? 0 : 64)
        .opacity(model.session.edgeLengths.isEmpty ? 0 : 1)
    }

    private var controls: some View {
        VStack(spacing: 12) {
            floorControl

            TextField("What is this room?", text: $model.name)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.done)
                .padding(.horizontal, 20)

            HStack(spacing: 20) {
                Button("Undo") { model.session.undoLastCorner() }
                    .disabled(model.session.corners.isEmpty)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    model.session.tap()
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                } label: {
                    Circle()
                        .strokeBorder(.white, lineWidth: 4)
                        .frame(width: 66, height: 66)
                        .background(Circle().fill(.white.opacity(0.25)))
                }

                Button("Done") { model.finish() }
                    .font(.headline)
                    .disabled(!model.session.canClose)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .padding(.horizontal, 20)
        }
        .padding(.vertical, 16)
        .background(.ultraThinMaterial)
    }
}

/// Saying where the floor is, when the phone will not work it out.
///
/// Plane detection is free when it happens and cannot be relied on, and there
/// is no way to find out from a phone why it did not fire. Three builds tried
/// to make it work and the third screenshot still said "move the phone slowly
/// across the floor" over a picture of a well-lit tiled floor. So the app stops
/// requiring it: lay the phone on the floor, tap once, and every corner after
/// that lands on a height a person stated.
private struct FloorControl: View {
    let from: ARMeasureSession.FloorFrom?
    let height: Float?
    let set: () -> Void
    let clear: () -> Void

    var body: some View {
        switch from {
        case .none:
            VStack(spacing: 6) {
                Text("Lay the phone flat on the floor, screen up")
                    .font(.subheadline)
                Button("Set floor", action: set)
                    .font(.headline)
                    .buttonStyle(.borderedProminent)
            }
        case .device:
            HStack(spacing: 10) {
                Text(
                    height.map { "Floor set — phone is \(Formatting.feetInches(metres: $0)) above it" }
                    ?? "Floor set"
                )
                .font(.caption)
                .foregroundStyle(.secondary)
                Button("Reset", action: clear)
                    .font(.caption)
            }
        case .plane:
            HStack(spacing: 10) {
                Text("Floor found")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Set it myself", action: clear)
                    .font(.caption)
            }
        }
    }
}

/// The aim point. Solid when there is something to put a corner on, hollow when
/// there is not — so a tap that would be refused looks refusable first.
private struct Reticle: View {
    let ready: Bool

    var body: some View {
        Circle()
            .strokeBorder(ready ? .white : .white.opacity(0.4), lineWidth: 3)
            .background(Circle().fill(ready ? .white.opacity(0.9) : .clear).frame(width: 8, height: 8))
            .frame(width: 28, height: 28)
            .shadow(radius: 3)
    }
}

private struct ARViewport: UIViewRepresentable {
    let session: ARMeasureSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        view.session = session.session
        view.automaticallyUpdatesLighting = true
        context.coordinator.view = view
        // The session raycasts through this for a tap, so it cannot depend on
        // the display link below having run. The link only moves the reticle.
        session.aimer = context.coordinator
        context.coordinator.start()
        return view
    }

    func updateUIView(_ view: ARSCNView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(session: session) }

    /// Keeps the reticle following whatever it is pointing at.
    ///
    /// A display link rather than ARSession's delegate, because the session's
    /// delegate is the model's and there is only one of those.
    @MainActor
    final class Coordinator: ARSCNViewProviding {
        weak var view: ARSCNView?
        private let session: ARMeasureSession
        private var link: CADisplayLink?

        init(session: ARMeasureSession) {
            self.session = session
        }

        func start() {
            let link = CADisplayLink(target: DisplayLinkProxy { [weak self] in
                guard let self else { return }
                self.session.updateAim(using: self)
            }, selector: #selector(DisplayLinkProxy.fire))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 10, maximum: 30, preferred: 20)
            link.add(to: .main, forMode: .common)
            self.link = link
        }

        func raycastQueryFromCentre() -> ARRaycastQuery? {
            guard let view else { return nil }
            let centre = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
            return view.raycastQuery(from: centre, allowing: .estimatedPlane, alignment: .horizontal)
        }

        deinit {
            link?.invalidate()
        }
    }
}

/// CADisplayLink needs an Objective-C target, and a closure is easier to read
/// than a second delegate.
private final class DisplayLinkProxy: NSObject {
    private let action: () -> Void

    init(action: @escaping () -> Void) {
        self.action = action
    }

    @objc func fire() {
        action()
    }
}
