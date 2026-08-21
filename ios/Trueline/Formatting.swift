import Foundation

/// Feet and inches, for the live readout during a scan.
///
/// **This is the only place in the app that formats a length, and it is
/// deliberately not a measurement.** It exists because a number has to be on
/// screen while somebody is standing in front of the wall, and the room model
/// that does this properly — exact nanometre integers, sixteenths, provenance —
/// is on the other side of the web view and does not exist yet at scan time.
///
/// So it rounds to the nearest half inch, and nothing it produces is ever
/// written to a file or carried anywhere. The moment the scan is saved, every
/// number a person sees comes from `core`, formatted by `formatFeetInches`,
/// with a band on it saying how much it might be out by. This is a glance, not
/// a figure.
enum Formatting {
    static func feetInches(metres: Float) -> String {
        guard metres.isFinite, metres > 0 else { return "—" }
        let totalHalfInches = (Double(metres) / 0.0254 * 2).rounded()
        let feet = Int(totalHalfInches) / 24
        let remainder = Int(totalHalfInches) % 24
        let inches = remainder / 2
        let half = remainder % 2 == 1 ? "½" : ""
        if feet == 0 { return "\(inches)\(half)\"" }
        if inches == 0 && half.isEmpty { return "\(feet)'" }
        return "\(feet)' \(inches)\(half)\""
    }
}
