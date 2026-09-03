import AVFoundation
import SwiftUI

/// Reads the barcode off a shelf tag.
///
/// ## Why this is here and a price feed is not
///
/// > "WHY ARE THERE NO LIVE VENDOR PRICES? HOME DEPOT? FLOOR AND DECOR?
/// >  JUST PULL THEM LIVE FROM THE SITE AND HAVE THEM LIVE WITH THE SKUS."
///
/// Checked on 2026-08-28 rather than assumed: **Home Depot publishes no
/// official public API.** What is on sale is third-party scraping services —
/// paid per request, broken the week the site changes, and returning the
/// *retail catalogue* price. That price is not what a contractor with a Pro
/// account pays. Quoting off it gives margin away or hands a client a number
/// he can look up and undercut.
///
/// The barcode is the honest half of the same wish. He is standing at the shelf
/// already. The phone reads the store's own code off the tag exactly — no
/// typing, nothing mistyped — and he enters the price he can actually see. It
/// costs nothing, there are no terms to break, and the number is his own.
///
/// ## What it will and will not read
///
/// The symbologies a building-supply shelf tag actually carries: UPC-A and
/// UPC-E, EAN-8 and EAN-13, Code 128 and Code 39, and Interleaved 2 of 5 —
/// which is what a great many warehouse racking labels use. QR is included
/// because Floor & Decor and others print one on the tag beside the price.
///
/// **A barcode is a name, never a number.** What comes back is filed as
/// `Sighting.code` in `core/src/vendor.ts` — the store's own code for a thing,
/// so it can be found again on their system. Nothing here is a price, a
/// quantity or a dimension, and nothing downstream may treat it as one.
@MainActor
final class BarcodeReader: NSObject, ObservableObject {

    /// What was read, or nothing while it is still looking.
    @Published private(set) var code: String?

    /// Why there is nothing to look at, when there is nothing to look at.
    @Published private(set) var trouble: String?

    let session = AVCaptureSession()

    /// The symbologies on a builders' merchant shelf tag.
    private static let kinds: [AVMetadataObject.ObjectType] = [
        .upce, .ean8, .ean13, .code39, .code93, .code128, .itf14, .interleaved2of5, .qr,
    ]

    /// Whether this reader has already answered.
    ///
    /// `AVCaptureMetadataOutput` delivers the same barcode many times a second
    /// for as long as it is in frame. Without this the screen would report the
    /// same tag thirty times and the far side would resolve a promise that was
    /// already resolved.
    private var answered = false

    func start() {
        guard !session.isRunning, !answered else { return }
        AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
            Task { @MainActor in
                guard let self else { return }
                guard allowed else {
                    // Said plainly, and it names the setting rather than the
                    // API: somebody standing in an aisle needs to know where to
                    // go, not which permission was refused.
                    self.trouble = "ScanToBid cannot use the camera. Turn it on in "
                        + "Settings › ScanToBid › Camera, or type the code from the tag instead."
                    return
                }
                self.build()
            }
        }
    }

    func stop() {
        guard session.isRunning else { return }
        // Off the main thread: `stopRunning()` blocks until the session has
        // actually torn down, and doing that on the main queue is a hitch the
        // whole screen wears.
        let running = session
        Task.detached { running.stopRunning() }
    }

    private func build() {
        guard
            let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
            let input = try? AVCaptureDeviceInput(device: camera),
            session.canAddInput(input)
        else {
            trouble = "This phone will not give ScanToBid its camera, so there is nothing to read "
                + "a tag with. Type the code from the tag instead."
            return
        }
        session.beginConfiguration()
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            trouble = "This phone will not read barcodes. Type the code from the tag instead."
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        // AFTER the output is added, and that order is not a style choice:
        // `metadataObjectTypes` is empty until the output belongs to a session,
        // so setting it first sets nothing and the reader looks at everything
        // and finds nothing.
        output.metadataObjectTypes = Self.kinds.filter {
            output.availableMetadataObjectTypes.contains($0)
        }
        session.commitConfiguration()

        let running = session
        Task.detached { running.startRunning() }
    }
}

extension BarcodeReader: AVCaptureMetadataOutputObjectsDelegate {
    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput objects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        let read = objects
            .compactMap { $0 as? AVMetadataMachineReadableCodeObject }
            .compactMap { $0.stringValue }
            .first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard let read else { return }
        Task { @MainActor [weak self] in
            guard let self, !self.answered else { return }
            self.answered = true
            self.code = read.trimmingCharacters(in: .whitespacesAndNewlines)
            self.stop()
        }
    }
}

/// The camera, on the screen, with a way out of it.
struct BarcodeScreen: View {
    @StateObject private var reader = BarcodeReader()
    /// Called with the code, or with nothing when somebody backs out.
    let onRead: (String?) -> Void

    var body: some View {
        ZStack {
            CameraView(session: reader.session).ignoresSafeArea()

            VStack {
                Spacer()
                if let trouble = reader.trouble {
                    Text(trouble)
                        .font(.callout)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding()
                        .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
                        .padding(.horizontal, 24)
                } else {
                    Text("Point at the barcode on the shelf tag")
                        .font(.callout)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.black.opacity(0.6), in: Capsule())
                }
                Button("Type it instead") { onRead(nil) }
                    .font(.headline)
                    .foregroundStyle(.white)
                    .frame(minHeight: 48)
                    .padding(.horizontal, 24)
                    .background(.black.opacity(0.6), in: Capsule())
                    .padding(.top, 16)
                    .padding(.bottom, 32)
            }
        }
        .onAppear { reader.start() }
        .onDisappear { reader.stop() }
        .onChange(of: reader.code) { _, read in
            guard let read else { return }
            onRead(read)
        }
    }
}

/// The preview layer, and a real one.
///
/// `makeUIView` hands back a fresh view every time and `updateUIView` swaps the
/// session onto it, which is the shape `check-scan.py` insists on: a viewport
/// that stores a view it was given once is the black camera screen this app has
/// already shipped.
private struct CameraView: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.layer.session = session
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {
        view.layer.session = session
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        // swiftlint:disable:next force_cast
        override var layer: AVCaptureVideoPreviewLayer { super.layer as! AVCaptureVideoPreviewLayer }
    }
}
