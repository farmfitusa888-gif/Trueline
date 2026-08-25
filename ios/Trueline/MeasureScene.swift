import ARKit
import SceneKit
import UIKit
import simd

/// What you have put in the room, drawn in the room.
///
/// Nothing used to be. `ARSCNView` was on screen showing the camera and not one
/// node was ever added to its scene, so a corner you placed left no mark: no
/// dot where you tapped, no line along the wall, nothing to say the app had
/// understood you. The only feedback anywhere was a number in a chip at the
/// bottom of the screen, and a number is not a place. That is what "there is no
/// way to select points, we are leaving it up to the app to decide" is — you
/// could not see what it had decided, so you could not correct it.
///
/// So everything is drawn: a dot on every corner, a bar along every wall, the
/// length floating on the bar, and a live bar from the last corner to wherever
/// you are pointing now. The first corner is drawn differently from the rest,
/// because the walk ends by finding it again.
///
/// Labels are drawn as images on billboarded planes rather than `SCNText`.
/// `SCNText` extrudes real geometry per glyph and re-tessellates whenever the
/// string changes, which is every frame for the live one.
@MainActor
final class MeasureScene {

    /// Corners and walls, rebuilt when they change.
    private let placed = SCNNode()
    /// The bar that follows the reticle, rebuilt every frame.
    private let live = SCNNode()
    /// What `placed` was last built from, so it is not rebuilt for nothing.
    private var builtFrom: String = "\u{0}"

    private enum Ink {
        static let wall = UIColor.white
        static let corner = UIColor.white
        /// The one you have to come back to.
        static let start = UIColor(red: 0.98, green: 0.65, blue: 0.15, alpha: 1)
        /// The one you are dragging.
        static let held = UIColor(red: 0.35, green: 0.78, blue: 1.00, alpha: 1)
        static let reaching = UIColor(red: 0.98, green: 0.65, blue: 0.15, alpha: 1)
    }

    func attach(to view: ARSCNView) {
        guard placed.parent == nil else { return }
        view.scene.rootNode.addChildNode(placed)
        view.scene.rootNode.addChildNode(live)
    }

    /// Draws the current state.
    ///
    /// - Parameters:
    ///   - corners: every point placed, in the order they were placed.
    ///   - held: the index being dragged, drawn so it is obvious which one moves.
    ///   - aim: where the reticle is now, or nothing when it is on nothing.
    ///   - closes: whether a bar should be drawn from the last corner back to
    ///     the first — true once the walk is long enough to close.
    ///   - length: how this app writes a length, so the scene says the same
    ///     thing as every other screen rather than inventing its own format.
    func draw(
        corners: [SIMD3<Float>],
        held: Int?,
        aim: SIMD3<Float>?,
        closes: Bool,
        length: (Float) -> String
    ) {
        let signature = corners.map { "\($0.x),\($0.y),\($0.z)" }
            .joined(separator: "|") + "#\(held.map(String.init) ?? "-")#\(closes)"
        if signature != builtFrom {
            builtFrom = signature
            rebuildPlaced(corners: corners, held: held, closes: closes, length: length)
        }

        live.childNodes.forEach { $0.removeFromParentNode() }
        guard let aim, let last = corners.last else { return }
        if let bar = bar(from: last, to: aim, colour: Ink.reaching, radius: 0.005) {
            live.addChildNode(bar)
            live.addChildNode(plaque(length(simd_distance(last, aim)),
                                     at: midpoint(last, aim), tint: Ink.reaching))
        }
    }

    private func rebuildPlaced(
        corners: [SIMD3<Float>],
        held: Int?,
        closes: Bool,
        length: (Float) -> String
    ) {
        placed.childNodes.forEach { $0.removeFromParentNode() }

        for (index, corner) in corners.enumerated() {
            let isHeld = index == held
            let isStart = index == 0
            let colour = isHeld ? Ink.held : (isStart ? Ink.start : Ink.corner)
            // The first corner is bigger because the walk ends by finding it
            // again, from across a room, over a shoulder.
            let radius: CGFloat = isHeld ? 0.030 : (isStart ? 0.028 : 0.020)
            placed.addChildNode(dot(at: corner, colour: colour, radius: radius))
            if isStart && corners.count > 1 {
                placed.addChildNode(ring(at: corner, colour: Ink.start, radius: 0.055))
            }
        }

        var runs: [(SIMD3<Float>, SIMD3<Float>)] = []
        for index in 1..<max(corners.count, 1) where corners.count > 1 {
            runs.append((corners[index - 1], corners[index]))
        }
        if closes, let first = corners.first, let last = corners.last, corners.count > 2 {
            runs.append((last, first))
        }
        for (from, to) in runs {
            if let bar = bar(from: from, to: to, colour: Ink.wall, radius: 0.006) {
                placed.addChildNode(bar)
                placed.addChildNode(plaque(length(simd_distance(from, to)),
                                           at: midpoint(from, to), tint: .white))
            }
        }
    }

    // ------------------------------------------------------------- geometry

    private func midpoint(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> SIMD3<Float> {
        (a + b) / 2
    }

    private func dot(at position: SIMD3<Float>, colour: UIColor, radius: CGFloat) -> SCNNode {
        let sphere = SCNSphere(radius: radius)
        sphere.segmentCount = 24
        sphere.firstMaterial = ink(colour)
        let node = SCNNode(geometry: sphere)
        node.simdPosition = position
        // Drawn over the camera picture rather than into it: a corner behind a
        // chair is still a corner you placed, and hiding it makes the app look
        // like it lost the point.
        node.renderingOrder = 20
        return node
    }

    /// A flat halo around the first corner, so it reads from across the room.
    private func ring(at position: SIMD3<Float>, colour: UIColor, radius: CGFloat) -> SCNNode {
        let torus = SCNTorus(ringRadius: radius, pipeRadius: 0.004)
        torus.ringSegmentCount = 36
        torus.firstMaterial = ink(colour.withAlphaComponent(0.85))
        let node = SCNNode(geometry: torus)
        node.simdPosition = position
        node.renderingOrder = 19
        return node
    }

    private func bar(
        from: SIMD3<Float>,
        to: SIMD3<Float>,
        colour: UIColor,
        radius: CGFloat
    ) -> SCNNode? {
        let span = to - from
        let distance = simd_length(span)
        // Two taps in the same spot are not a wall, and a zero-height cylinder
        // is a divide by zero in the orientation below.
        guard distance > 0.002 else { return nil }

        let cylinder = SCNCylinder(radius: radius, height: CGFloat(distance))
        cylinder.radialSegmentCount = 12
        cylinder.firstMaterial = ink(colour)
        let node = SCNNode(geometry: cylinder)
        node.simdPosition = midpoint(from, to)
        node.simdOrientation = rotation(from: SIMD3<Float>(0, 1, 0), to: span / distance)
        node.renderingOrder = 18
        return node
    }

    /// The turn that takes one unit vector onto another.
    ///
    /// `simd_quatf(from:to:)` is documented as undefined for vectors pointing
    /// exactly opposite ways, and a cylinder drawn straight down the -Y axis is
    /// exactly that case — which is a wall drawn while pointing at the floor.
    private func rotation(from: SIMD3<Float>, to: SIMD3<Float>) -> simd_quatf {
        let alignment = simd_dot(from, to)
        if alignment > 0.99999 { return simd_quatf(angle: 0, axis: SIMD3<Float>(0, 1, 0)) }
        if alignment < -0.99999 { return simd_quatf(angle: .pi, axis: SIMD3<Float>(1, 0, 0)) }
        return simd_quatf(from: from, to: to)
    }

    private func ink(_ colour: UIColor) -> SCNMaterial {
        let material = SCNMaterial()
        material.diffuse.contents = colour
        // Unlit: a room lit by one bulb should not make its own dimensions dim.
        material.lightingModel = .constant
        material.readsFromDepthBuffer = false
        material.writesToDepthBuffer = false
        material.isDoubleSided = true
        return material
    }

    // --------------------------------------------------------------- labels

    private func plaque(_ text: String, at position: SIMD3<Float>, tint: UIColor) -> SCNNode {
        let plane = SCNPlane(width: 0.001, height: 0.001)
        let image = plaqueImage(text, tint: tint)
        let height: CGFloat = 0.05
        plane.height = height
        plane.width = height * image.size.width / image.size.height
        plane.cornerRadius = 0

        let material = SCNMaterial()
        material.diffuse.contents = image
        material.lightingModel = .constant
        material.isDoubleSided = true
        material.readsFromDepthBuffer = false
        material.writesToDepthBuffer = false
        plane.firstMaterial = material

        let node = SCNNode(geometry: plane)
        node.simdPosition = position + SIMD3<Float>(0, 0.05, 0)
        // Faces whoever is holding the phone, from anywhere in the room.
        node.constraints = [SCNBillboardConstraint()]
        node.renderingOrder = 30
        return node
    }

    private func plaqueImage(_ text: String, tint: UIColor) -> UIImage {
        let font = UIFont.monospacedDigitSystemFont(ofSize: 64, weight: .semibold)
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: tint]
        let measured = (text as NSString).size(withAttributes: attributes)
        let padX: CGFloat = 30
        let padY: CGFloat = 16
        let box = CGSize(width: measured.width + padX * 2, height: measured.height + padY * 2)
        return UIGraphicsImageRenderer(size: box).image { _ in
            UIBezierPath(roundedRect: CGRect(origin: .zero, size: box),
                         cornerRadius: box.height * 0.28).addClip()
            UIColor(white: 0.04, alpha: 0.86).setFill()
            UIRectFill(CGRect(origin: .zero, size: box))
            (text as NSString).draw(at: CGPoint(x: padX, y: padY), withAttributes: attributes)
        }
    }
}
