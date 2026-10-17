import Foundation
import HubAPI
import ImageIO
import UniformTypeIdentifiers

/// Something a parent hands Cookie with a question: screenshots or a pasted
/// text (intent 0019, SHT-1..4). Kept in memory until sent, never on disk
/// (SHSEC-1).
public enum CookieAttachment: Equatable, Sendable {
    /// JPEGs already shrunk for sending (SHT-2).
    case images([Data])
    case pasted(String)

    /// SHT-1, SHT-2: three pictures at most.
    public static let imageLimit = 3
    /// SHT-3: a paste longer than a question becomes an attachment, up to this.
    public static let pastedLimit = 8000

    /// "2 screenshots", "Pasted text, 1,240 characters".
    public var label: String {
        switch self {
        case .images(let images):
            images.count == 1 ? "1 screenshot" : "\(images.count) screenshots"
        case .pasted(let text):
            "Pasted text, \(text.count.formatted()) characters"
        }
    }

    /// A paste, cut to the limit; and whether it was cut.
    public static func pasted(from text: String) -> (attachment: CookieAttachment, cut: Bool)? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return (.pasted(String(trimmed.prefix(pastedLimit))), trimmed.count > pastedLimit)
    }

    /// SHT-3: typed or pasted into the field, past this it's material, not a question.
    public static func isLongPaste(_ text: String) -> Bool {
        text.count > CookieChat.questionLimit
    }
}

extension CookieChat {
    /// What a typed question with an attachment sends: the words may be
    /// empty when something is attached (SHA-4).
    public static func question(_ draft: String, with attachment: CookieAttachment?) -> String?? {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.count > questionLimit { return nil }
        if text.isEmpty { return attachment == nil ? nil : .some(nil) }
        return .some(text)
    }

    public static func body(
        text: String?, attachment: CookieAttachment?, conversationId: String?
    ) -> Operations.AskAssistant.Input.Body {
        var payload = Operations.AskAssistant.Input.Body.JsonPayload(conversationId: conversationId, text: text)
        switch attachment {
        case .images(let images):
            payload.images = images.map { .init(data: $0.base64EncodedString(), mimeType: "image/jpeg") }
        case .pasted(let pasted):
            payload.pasted = pasted
        case nil:
            break
        }
        return .json(payload)
    }

    /// The question's bubble with what came with it: "add this · 2 screenshots".
    static func questionText(_ heard: String, shared: Components.Schemas.Shared?) -> String {
        guard let shared else { return heard }
        let label =
            shared.kind == .images
            ? CookieAttachment.images(Array(repeating: Data(), count: Int(shared.count))).label
            : "Pasted text, \(Int(shared.count).formatted()) characters"
        return heard.isEmpty ? label : "\(heard) · \(label)"
    }
}

/// SHT-2: a picture as a JPEG for Cookie, its long side at most 2,048 px and
/// at most 1 MB, quality lowered until it fits. Used by the app and the
/// share extension, which has little memory: the picture is decoded at the
/// smaller size straight from its file data.
public enum CookieImage {
    public static let longSide = 2048
    public static let maxBytes = 1024 * 1024

    public static func jpeg(from data: Data, longSide: Int = longSide, maxBytes: Int = maxBytes) -> Data? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
        else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: longSide,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        for quality in [0.8, 0.65, 0.5, 0.35] {
            if let out = encode(image, quality: quality), out.count <= maxBytes { return out }
        }
        // Still too big: a smaller picture.
        return longSide > 1024 ? jpeg(from: data, longSide: longSide * 3 / 4, maxBytes: maxBytes) : nil
    }

    private static func encode(_ image: CGImage, quality: Double) -> Data? {
        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else {
            return nil
        }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(dest) ? out as Data : nil
    }
}
