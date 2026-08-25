import Combine
import CoreLocation
import Foundation

/// Which way the room faces.
///
/// A plan without north on it is not a construction drawing, and until now
/// Trueline had none — the "north" in the model is a name for one axis of a
/// datum the importer picked, which is the longest wall. Sam looked at a plan of
/// a kitchen, compared it to his memory of the room, and could not line the two
/// up. That is what a compass rose is for.
///
/// **This is measured, and it is not precise, and it says so.** Indoors a
/// magnetometer sits inside a steel-framed building full of appliances, wiring
/// and magnets, and its heading can be tens of degrees out. Core Location
/// reports its own accuracy alongside every reading, and that number is carried
/// all the way to the drawing rather than dropped — a plan that says "north,
/// give or take 30 degrees" is honest; one that draws a crisp arrow off the same
/// reading is not.
///
/// Nothing else depends on it. No length, no area, no quantity changes because
/// the compass was wrong or absent, which is why it can be approximate and still
/// be worth having.
@MainActor
final class Compass: NSObject, ObservableObject, CLLocationManagerDelegate {

    /// A heading, exactly as Core Location gave it.
    struct Reading {
        /// Degrees clockwise from true north, 0 to 360.
        let trueNorth: Double
        /// Core Location's own estimate of how wrong that could be, in degrees.
        /// Negative means it does not consider the reading valid at all.
        let accuracy: Double
        let takenAt: Date

        /// Whether it is worth showing. Apple reports a negative accuracy for a
        /// heading it does not trust, and a needle swinging 90 degrees is worse
        /// than no needle.
        var usable: Bool { accuracy >= 0 && accuracy <= 40 }
    }

    @Published private(set) var latest: Reading?
    /// Set when the compass cannot run at all, so a screen can say why rather
    /// than showing an arrow that never moves.
    @Published private(set) var unavailable: String?

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        // A degree of change is finer than the reading is accurate to; this only
        // controls how often the delegate fires.
        manager.headingFilter = 2
    }

    func start() {
        guard CLLocationManager.headingAvailable() else {
            unavailable = "This device has no compass."
            return
        }
        // Heading needs location authorisation on iOS even though no position is
        // wanted or kept. Asked for while in use only, and never stored.
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        manager.startUpdatingHeading()
    }

    func stop() {
        manager.stopUpdatingHeading()
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateHeading heading: CLHeading) {
        let reading = Reading(
            trueNorth: heading.trueHeading >= 0 ? heading.trueHeading : heading.magneticHeading,
            accuracy: heading.headingAccuracy,
            takenAt: heading.timestamp
        )
        Task { @MainActor in self.latest = reading }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.unavailable = "The compass could not be read: \(error.localizedDescription)"
        }
    }

    /// Whether iOS should be allowed to put its calibration card on screen.
    ///
    /// Yes: a reading taken through an uncalibrated magnetometer is the thing
    /// this class exists to avoid publishing, and the card is how a person fixes
    /// it in five seconds.
    nonisolated func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool {
        true
    }
}
