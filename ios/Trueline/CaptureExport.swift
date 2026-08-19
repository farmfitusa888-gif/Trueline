import Foundation
import RoomPlan
import simd

/// Turns Apple's `CapturedRoom` into the file the rest of Trueline reads.
///
/// RoomPlan speaks in `Float` metres and 4x4 transforms. Everything past this
/// point speaks in whole nanometres, because an inch is exactly 25.4 mm and a
/// dimension that rounds is a cabinet that does not fit. This file is the one
/// place a float becomes an integer, and it happens once, here, at the boundary.
///
/// What RoomPlan does not tell us honestly, we do not pretend to know:
///   - Wall thickness comes back as a uniform ~16 cm whatever the wall really is,
///     so it is exported as `thicknessIsAssumed: true` rather than as a fact.
///   - Confidence is reported per surface and carried through, so a wall the
///     sensor was unsure about arrives already marked unsure.

enum CaptureExportError: Error, LocalizedError {
    case notFinite(String)

    var errorDescription: String? {
        switch self {
        case .notFinite(let what):
            return "RoomPlan returned a value for \(what) that is not a finite number. "
                 + "The scan cannot be exported without inventing a dimension for it."
        }
    }
}

/// One metre in nanometres.
private let nmPerMetre: Double = 1_000_000_000

private func nanometres(_ metres: Float, _ what: String) throws -> Int64 {
    let value = Double(metres) * nmPerMetre
    guard value.isFinite else { throw CaptureExportError.notFinite(what) }
    return Int64(value.rounded())
}

/// Nanometres cross into JSON as decimal strings, for the same reason the ledger
/// serialises money as one: JSON numbers are doubles and would silently round.
private func nmString(_ metres: Float, _ what: String) throws -> String {
    String(try nanometres(metres, what))
}

// MARK: - The file format

struct CaptureFile: Encodable {
    let schema = "trueline.capture.v1"
    let capturedAt: String
    let device: String
    let sensor = "roomplan"
    /// Apple's own note on this scan's reliability, carried through untouched.
    let ceilingHeightNm: String?
    let walls: [Surface]
    let openings: [Opening]
    let objects: [DetectedObject]
    let notes: [String]
}

struct Surface: Encodable {
    let id: String
    let lengthNm: String
    let heightNm: String
    let thicknessNm: String
    /// RoomPlan models every wall at a uniform thickness regardless of the real
    /// one, so this is flagged rather than trusted.
    let thicknessIsAssumed: Bool
    /// Degrees clockwise from north, in the room's own frame, 0–360.
    let headingDegrees: Double
    let startXNm: String
    let startYNm: String
    let endXNm: String
    let endYNm: String
    let confidence: String
}

struct Opening: Encodable {
    let id: String
    let kind: String          // door | window | opening
    let widthNm: String
    let heightNm: String
    let centreXNm: String
    let centreYNm: String
    let confidence: String
}

struct DetectedObject: Encodable {
    let id: String
    let category: String
    let widthNm: String
    let depthNm: String
    let heightNm: String
    let confidence: String
}

// MARK: - Conversion

private func confidenceName(_ c: CapturedRoom.Confidence) -> String {
    switch c {
    case .high: return "high"
    case .medium: return "medium"
    case .low: return "low"
    @unknown default: return "unknown"
    }
}

/// A surface's centre on the floor plane, and the direction it runs.
///
/// RoomPlan puts the surface's local +X along its length, so the wall's
/// direction is the transform's first column. The floor plane is X/Z in ARKit's
/// right-handed frame with -Z pointing away from the viewer, so plan coordinates
/// are (x, -z) and a heading measured clockwise from north falls straight out of
/// atan2 on those.
private func planGeometry(_ transform: simd_float4x4, length: Float)
    -> (centre: SIMD2<Float>, start: SIMD2<Float>, end: SIMD2<Float>, headingDegrees: Double)
{
    let centre = SIMD2<Float>(transform.columns.3.x, -transform.columns.3.z)
    let along = SIMD2<Float>(transform.columns.0.x, -transform.columns.0.z)
    let unit = simd_length(along) > 0 ? along / simd_length(along) : SIMD2<Float>(1, 0)
    let half = unit * (length / 2)

    var degrees = Double(atan2(Double(unit.x), Double(unit.y))) * 180 / .pi
    if degrees < 0 { degrees += 360 }

    return (centre, centre - half, centre + half, degrees)
}

extension CapturedRoom {
    func truelineExport(device: String, capturedAt: Date = Date()) throws -> CaptureFile {
        var notes: [String] = []

        let walls: [Surface] = try self.walls.map { wall in
            let g = planGeometry(wall.transform, length: wall.dimensions.x)
            return Surface(
                id: wall.identifier.uuidString,
                lengthNm: try nmString(wall.dimensions.x, "wall length"),
                heightNm: try nmString(wall.dimensions.y, "wall height"),
                thicknessNm: try nmString(wall.dimensions.z, "wall thickness"),
                thicknessIsAssumed: true,
                headingDegrees: g.headingDegrees,
                startXNm: try nmString(g.start.x, "wall start x"),
                startYNm: try nmString(g.start.y, "wall start y"),
                endXNm: try nmString(g.end.x, "wall end x"),
                endYNm: try nmString(g.end.y, "wall end y"),
                confidence: confidenceName(wall.confidence)
            )
        }

        if walls.isEmpty {
            notes.append("RoomPlan returned no walls. The scan did not resolve a room.")
        }

        func opening(_ s: CapturedRoom.Surface, kind: String) throws -> Opening {
            let g = planGeometry(s.transform, length: s.dimensions.x)
            return Opening(
                id: s.identifier.uuidString,
                kind: kind,
                widthNm: try nmString(s.dimensions.x, "\(kind) width"),
                heightNm: try nmString(s.dimensions.y, "\(kind) height"),
                centreXNm: try nmString(g.centre.x, "\(kind) centre x"),
                centreYNm: try nmString(g.centre.y, "\(kind) centre y"),
                confidence: confidenceName(s.confidence)
            )
        }

        var openings: [Opening] = []
        openings += try self.doors.map { try opening($0, kind: "door") }
        openings += try self.windows.map { try opening($0, kind: "window") }
        openings += try self.openings.map { try opening($0, kind: "opening") }

        let objects: [DetectedObject] = try self.objects.map { object in
            DetectedObject(
                id: object.identifier.uuidString,
                category: String(describing: object.category),
                widthNm: try nmString(object.dimensions.x, "object width"),
                depthNm: try nmString(object.dimensions.z, "object depth"),
                heightNm: try nmString(object.dimensions.y, "object height"),
                confidence: confidenceName(object.confidence)
            )
        }

        // Ceiling height is the tallest wall rather than a reported figure —
        // RoomPlan does not give one, and the tallest wall is the honest proxy.
        let tallest = self.walls.map(\.dimensions.y).max()
        if tallest == nil {
            notes.append("No ceiling height could be derived, because no walls were found.")
        }

        let lowConfidence = walls.filter { $0.confidence != "high" }.count
        if lowConfidence > 0 {
            notes.append("\(lowConfidence) of \(walls.count) walls came back below high confidence.")
        }

        let stamp = ISO8601DateFormatter()
        stamp.formatOptions = [.withInternetDateTime]

        return CaptureFile(
            capturedAt: stamp.string(from: capturedAt),
            device: device,
            ceilingHeightNm: tallest.map { try? nmString($0, "ceiling height") } ?? nil,
            walls: walls,
            openings: openings,
            objects: objects,
            notes: notes
        )
    }

    /// Writes the Trueline JSON and Apple's own USDZ side by side, and returns
    /// both so they can go into a share sheet together. The USDZ is kept because
    /// it is the ground truth to check our own reading of the scan against.
    func writeExports(device: String, into directory: URL, name: String) throws -> [URL] {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        let jsonURL = directory.appendingPathComponent("\(name).trueline.json")
        try encoder.encode(try truelineExport(device: device)).write(to: jsonURL)

        let usdzURL = directory.appendingPathComponent("\(name).usdz")
        try export(to: usdzURL, exportOptions: .parametric)

        return [jsonURL, usdzURL]
    }
}
