import ARKit
import SceneKit
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
                // The crosshair marks where the shutter aims. Touching the
                // picture anywhere aims there instead, so the crosshair must
                // never look like the only place a point can go.
                .allowsHitTesting(false)

            VStack(spacing: 0) {
                Text(model.instruction)
                    .font(.headline)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .padding(.top, 12)
                    .padding(.horizontal, 20)

                modes

                Spacer()
                readout
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
        // Through the model, like the Scan tab, so there is one place that
        // knows what leaving a tab means. Coming back resumes rather than
        // restarting: see `ARMeasureSession.resume()`.
        .onDisappear { model.stepAway() }
        .onChange(of: model.finished) { _, scan in
            guard let scan else { return }
            onFinished(scan)
        }
    }

    /// Walking a room, or measuring one thing.
    private var modes: some View {
        Picker("What are you measuring?", selection: Binding(
            get: { model.session.mode },
            set: { model.session.mode = $0 }
        )) {
            ForEach(ARMeasureSession.Mode.allCases) { mode in
                Text(mode.title).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .frame(maxWidth: 320)
    }

    /// One measurement, big enough to read at arm's length and write down.
    @ViewBuilder
    private var readout: some View {
        if model.session.mode == .distance {
            VStack(spacing: 2) {
                Text(model.session.spanLength.map { Formatting.feetInches(metres: $0) } ?? "—")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .monospacedDigit()
                Text(model.session.span.count == 2
                     ? "touch anywhere to start another"
                     : "touch each end")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
            .padding(.bottom, 12)
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
                // A label and a border, not a word. "Undo doesn't work" was
                // reported against a button whose only feedback was a number
                // in a chip that had already scrolled away -- and going from
                // two corners to one leaves the instruction saying exactly the
                // same sentence, so nothing on screen changed. It says how many
                // points are down, so taking one back is something you can see.
                Button {
                    model.session.undoLastCorner()
                    UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
                } label: {
                    Label(model.undoTitle, systemImage: "arrow.uturn.backward")
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 14)
                        .frame(minHeight: 44)
                        .background(.ultraThinMaterial, in: Capsule())
                }
                .disabled(!model.session.canUndo)
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
                .accessibilityLabel("Put a point where the crosshair is")

                Button("Done") { model.finish() }
                    .font(.headline)
                    .disabled(!model.session.canClose || model.session.mode != .room)
                    .opacity(model.session.mode == .room ? 1 : 0)
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
/// Where the shutter aims.
///
/// The old one was a three-point ring in white at forty per cent, which over a
/// lit wooden floor -- the surface this app is pointed at more than any other --
/// is not there. Every stroke here is drawn twice: black underneath, white on
/// top. That is how a crosshair stays visible on a white wall and a dark
/// carpet without knowing which it is on.
private struct Reticle: View {
    let ready: Bool

    private let ring: CGFloat = 30
    private let arm: CGFloat = 13

    var body: some View {
        ZStack {
            marks(colour: .black.opacity(0.55), width: 5)
            marks(colour: .white, width: 2)
            Circle()
                .fill(ready ? Color.white : Color.white.opacity(0.35))
                .frame(width: 5, height: 5)
        }
        .frame(width: ring + arm * 2, height: ring + arm * 2)
        .animation(.easeOut(duration: 0.15), value: ready)
        .accessibilityHidden(true)
    }

    private func marks(colour: Color, width: CGFloat) -> some View {
        ZStack {
            Circle()
                .strokeBorder(colour, lineWidth: width)
                .frame(width: ring, height: ring)
            ForEach(0..<4, id: \.self) { quarter in
                Capsule()
                    .fill(colour)
                    .frame(width: width, height: arm)
                    .offset(y: -(ring / 2 + arm / 2 + 3))
                    .rotationEffect(.degrees(Double(quarter) * 90))
            }
        }
        .opacity(ready ? 1 : 0.75)
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
        context.coordinator.scene.attach(to: view)

        // Touching the picture is how a point gets chosen. Recognisers here
        // rather than a SwiftUI gesture because the point has to be in this
        // view's own coordinates to be raycast through, and a SwiftUI gesture
        // on a layout that ignores the safe area is a coordinate space you
        // have to reason about instead of one you are handed.
        let tap = UITapGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.touched(_:)))
        view.addGestureRecognizer(tap)

        let drag = UIPanGestureRecognizer(target: context.coordinator,
                                          action: #selector(Coordinator.dragged(_:)))
        view.addGestureRecognizer(drag)

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
        let scene = MeasureScene()
        /// Whether this drag started on a corner. A drag that did not is
        /// ignored to its end, so a thumb steadying the phone never moves one.
        private var dragging = false
        private let session: ARMeasureSession
        private var link: CADisplayLink?

        init(session: ARMeasureSession) {
            self.session = session
        }

        func start() {
            let link = CADisplayLink(target: DisplayLinkProxy { [weak self] in
                guard let self else { return }
                self.session.updateAim(using: self)
                self.redraw()
            }, selector: #selector(DisplayLinkProxy.fire))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 10, maximum: 30, preferred: 20)
            link.add(to: .main, forMode: .common)
            self.link = link
        }

        func raycastQueryFromCentre() -> ARRaycastQuery? {
            guard let view else { return nil }
            return raycastQuery(at: CGPoint(x: view.bounds.midX, y: view.bounds.midY))
        }

        func raycastQuery(at point: CGPoint) -> ARRaycastQuery? {
            view?.raycastQuery(from: point, allowing: .estimatedPlane, alignment: .horizontal)
        }

        func screenPoint(for world: SIMD3<Float>) -> CGPoint? {
            guard let view else { return nil }
            let projected = view.projectPoint(SCNVector3(world.x, world.y, world.z))
            // Behind the camera, or past the far plane: on screen it would be a
            // point somewhere it is not, and a finger would grab the wrong one.
            guard projected.z > 0, projected.z < 1 else { return nil }
            return CGPoint(x: CGFloat(projected.x), y: CGFloat(projected.y))
        }

        @objc func touched(_ gesture: UITapGestureRecognizer) {
            guard let view else { return }
            session.place(at: gesture.location(in: view))
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        }

        /// Dragging a corner you have already put down.
        ///
        /// Only ever a corner: a drag that does not start on one is let go, so
        /// a thumb sliding across the picture to steady the phone does not pick
        /// up the nearest point and carry it across the room.
        @objc func dragged(_ gesture: UIPanGestureRecognizer) {
            guard let view else { return }
            let point = gesture.location(in: view)
            switch gesture.state {
            case .began:
                dragging = session.grab(at: point)
            case .changed:
                guard dragging else { return }
                session.dragHeld(to: point)
            case .ended, .cancelled, .failed:
                guard dragging else { return }
                dragging = false
                session.release()
            default:
                break
            }
        }

        /// Draws the corners and walls into the scene, every frame the link runs.
        func redraw() {
            switch session.mode {
            case .room:
                scene.draw(corners: session.corners.map(\.position),
                           held: session.held,
                           aim: session.aimingAt,
                           closes: session.canClose,
                           length: { Formatting.feetInches(metres: $0) })
            case .distance:
                scene.draw(corners: session.span.map(\.position),
                           held: nil,
                           aim: session.span.count == 1 ? session.aimingAt : nil,
                           closes: false,
                           length: { Formatting.feetInches(metres: $0) })
            }
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
