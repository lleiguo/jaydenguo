import CoreGraphics
import Foundation
import HubAPI
import ImageIO
import Testing
import UniformTypeIdentifiers
@testable import HubKit

/// Screenshots and pasted text for Cookie (intent 0019, plan S2).
@Suite struct CookieShareTests {
    /// A PNG of the given size, noisy enough that JPEG can't shrink it to nothing.
    private func png(width: Int, height: Int) throws -> Data {
        let context = try #require(CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        var seed: UInt64 = 42
        for y in stride(from: 0, to: height, by: 8) {
            for x in stride(from: 0, to: width, by: 8) {
                seed = seed &* 6364136223846793005 &+ 1
                let v = Double(seed >> 40 & 0xff) / 255
                context.setFillColor(red: v, green: 1 - v, blue: v / 2, alpha: 1)
                context.fill(CGRect(x: x, y: y, width: 8, height: 8))
            }
        }
        let out = NSMutableData()
        let dest = try #require(CGImageDestinationCreateWithData(out, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(dest, try #require(context.makeImage()), nil)
        #expect(CGImageDestinationFinalize(dest))
        return out as Data
    }

    private func size(_ jpeg: Data) throws -> (Int, Int) {
        let source = try #require(CGImageSourceCreateWithData(jpeg as CFData, nil))
        let props = try #require(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        return (props[kCGImagePropertyPixelWidth] as? Int ?? 0, props[kCGImagePropertyPixelHeight] as? Int ?? 0)
    }

    @Test func aBigScreenshotIsShrunkToAJpegUnderOneMegabyte() throws {
        let jpeg = try #require(CookieImage.jpeg(from: try png(width: 1290, height: 2796)))
        #expect(jpeg.count <= CookieImage.maxBytes)
        #expect(jpeg.prefix(3) == Data([0xFF, 0xD8, 0xFF]))
        let (w, h) = try size(jpeg)
        #expect(max(w, h) <= CookieImage.longSide)
        // The shape is kept.
        #expect(abs(Double(w) / Double(h) - 1290.0 / 2796.0) < 0.01)
    }

    @Test func aSmallPictureKeepsItsSize() throws {
        let (w, h) = try size(try #require(CookieImage.jpeg(from: try png(width: 400, height: 300))))
        #expect(w == 400 && h == 300)
    }

    @Test func somethingThatIsntAPictureIsRefused() {
        #expect(CookieImage.jpeg(from: Data("not a picture".utf8)) == nil)
    }

    @Test func aLongPasteBecomesAnAttachmentCutAtTheLimit() throws {
        #expect(!CookieAttachment.isLongPaste(String(repeating: "a", count: 500)))
        #expect(CookieAttachment.isLongPaste(String(repeating: "a", count: 501)))
        let (attachment, cut) = try #require(CookieAttachment.pasted(from: String(repeating: "a", count: 9000)))
        #expect(cut)
        #expect(attachment == .pasted(String(repeating: "a", count: 8000)))
        #expect(attachment.label == "Pasted text, 8,000 characters")
        #expect(CookieAttachment.pasted(from: "  \n ") == nil)
        #expect(CookieAttachment.images([Data(), Data()]).label == "2 screenshots")
    }

    @Test func anAttachmentNeedsNoWordsButWordsStayShort() {
        let pasted = CookieAttachment.pasted("Practice moved to Saturday")
        #expect(CookieChat.question("", with: nil) == nil)
        #expect(CookieChat.question("  ", with: pasted) == .some(nil))
        #expect(CookieChat.question("add this", with: pasted) == .some("add this"))
        #expect(CookieChat.question(String(repeating: "a", count: 501), with: pasted) == nil)
    }

    @Test func theBodyCarriesThePicturesOrThePaste() throws {
        guard case .json(let pictures) = CookieChat.body(
            text: nil, attachment: .images([Data([0xFF, 0xD8, 0xFF])]), conversationId: "c1"
        ) else { Issue.record("not JSON"); return }
        #expect(pictures.text == nil)
        #expect(pictures.conversationId == "c1")
        #expect(pictures.images?.map(\.mimeType) == ["image/jpeg"])
        #expect(pictures.images?.first?.data == "/9j/")
        #expect(pictures.pasted == nil)
        guard case .json(let paste) = CookieChat.body(text: "add this", attachment: .pasted("Sat 9am"), conversationId: nil)
        else { Issue.record("not JSON"); return }
        #expect(paste.text == "add this")
        #expect(paste.pasted == "Sat 9am")
        #expect(paste.images == nil)
    }

    @Test func historyNamesWhatWasSharedAndWhereTheAnswerCameFrom() {
        let shared = CookieSource(kind: ._self, label: "What you shared", shared: true)
        let turns = [
            CookieTurn(
                id: "t1", conversationId: "c1", mode: .text, heard: "", text: "Practice moved to Saturday.",
                outcome: .answer, language: .en, sources: [shared], did: nil, waiting: nil,
                shared: .init(kind: .images, count: 2), createdAt: "2026-10-17T15:00:00.000Z"
            ),
            CookieTurn(
                id: "t2", conversationId: "c1", mode: .text, heard: "add this", text: "Adding: practice.",
                outcome: .answer, language: .en, sources: [CookieSource(kind: .hub, label: "Calendar"), shared],
                did: nil, waiting: nil, shared: .init(kind: .pasted, count: 1240), createdAt: "2026-10-17T15:01:00.000Z"
            ),
        ]
        let messages = CookieChat.messages(turns)
        #expect(messages.map(\.text) == [
            "2 screenshots", "Practice moved to Saturday.", "add this · Pasted text, 1,240 characters", "Adding: practice.",
        ])
        #expect(messages[1].sourceLine == "From what you shared")
        #expect(messages[3].sourceLine == "From Calendar, what you shared")
    }
}
