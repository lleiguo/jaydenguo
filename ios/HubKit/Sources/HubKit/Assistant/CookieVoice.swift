import Foundation
import HubAPI
import OpenAPIRuntime

/// The rules of talking to Cookie (intent 0007, CK-2, CK-3, VOX-5), kept
/// out of the views and the audio code so they're tested without a
/// simulator.
public enum CookieVoice {
    /// CK-2: a press this long starts recording; shorter is a tap.
    public static let holdDelay: TimeInterval = 0.2
    /// A recording shorter than this is thrown away ("Hold to talk").
    public static let shortestClip: TimeInterval = 0.5
    /// LIM-3: recording stops and sends here.
    public static let longestClip: TimeInterval = 30
    /// CK-3: the bubble closes this long after she stops speaking.
    public static let bubbleLinger: TimeInterval = 5
    /// Longer when the answer added an event, so there is time to read the
    /// card and tap Undo (intent 0008, CASEC-4).
    public static func linger(_ answer: CookieMessage) -> TimeInterval {
        // While she checks the mail, long enough for the summary to arrive
        // in the bubble most times (intent 0009, ERA-4).
        if answer.waitingUntil != nil { return 45 }
        return answer.changes == nil ? bubbleLinger : 15
    }
    /// What the recorder writes: AAC in an MPEG-4 file (plan SP-C5).
    public static let clipType = "audio/mp4"
    public static let sampleRate = 16_000.0
    public static let bitRate = 24_000

    /// What lifting the finger does.
    public enum Release: Equatable, Sendable {
        /// Recording never started: open the chat (CK-4).
        case tap
        /// The finger slid off the button: nothing is sent.
        case cancel
        /// Too short to be a question.
        case tooShort
        case send
    }

    /// `recordedFor` is nil when recording hadn't started yet.
    public static func release(recordedFor: TimeInterval?, inside: Bool) -> Release {
        guard let recordedFor else { return inside ? .tap : .cancel }
        if !inside { return .cancel }
        return recordedFor < shortestClip ? .tooShort : .send
    }

    /// Is the finger still on the button? A little slack, so a wobble
    /// doesn't cancel.
    public static func isInside(x: Double, y: Double, size: Double, slack: Double = 36) -> Bool {
        x >= -slack && y >= -slack && x <= size + slack && y <= size + slack
    }

    /// The level ring, 0 to 1, from the recorder's decibels (-160 to 0).
    public static func level(decibels: Float) -> Double {
        let floor: Float = -50
        guard decibels.isFinite, decibels > floor else { return 0 }
        return Double(min(1, (decibels - floor) / -floor))
    }

    /// The ask call's body for a recording.
    public static func body(clip: Data, conversationId: String?) -> Operations.AskAssistant.Input.Body {
        .json(.init(
            conversationId: conversationId,
            audio: .init(data: clip.base64EncodedString(), mimeType: clipType)
        ))
    }

    /// Whether an answer is read aloud at all: spoken answers are on, and
    /// there are words to read.
    public static func speaks(_ answer: CookieAnswer, spokenAnswers: Bool) -> Bool {
        spokenAnswers && !spokenText(answer.text).isEmpty
    }

    /// The answer as the phone's own voice reads it when the server's
    /// voice can't (VOX-5): links aren't read out.
    public static func spokenText(_ text: String, fromWeb: Bool = false, language: String? = nil) -> String {
        let plain = text
            .replacingOccurrences(of: #"https?://\S+"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"[*_#`]+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        guard !plain.isEmpty, fromWeb else { return plain }
        // CHR-4: she says when an answer is from the web.
        return isChinese(language) ? "网上说：\(plain)" : "From the web: \(plain)"
    }

    /// The phone voice's language for an answer: Mandarin for Chinese and
    /// mixed answers, as the server's voice is chosen.
    public static func voiceLanguage(_ language: String?) -> String {
        isChinese(language) ? "zh-CN" : "en-US"
    }

    private static func isChinese(_ language: String?) -> Bool { language == "zh" || language == "mixed" }

    /// "0:07" beside the level ring.
    public static func clock(_ seconds: TimeInterval) -> String {
        let s = max(0, Int(seconds))
        return "\(s / 60):" + (s % 60 < 10 ? "0" : "") + "\(s % 60)"
    }
}

extension CookieChat {
    /// A spoken question's bubbles: what she heard (VOX-2), then what she
    /// said. Nothing heard, no question bubble.
    public static func messages(spoken answer: CookieAnswer) -> [CookieMessage] {
        let heard = answer.heard.trimmingCharacters(in: .whitespacesAndNewlines)
        let question = heard.isEmpty ? [] : [CookieMessage(id: answer.turnId + "-q", role: .you, text: heard)]
        return question + [message(answer)]
    }
}

extension HubClient {
    /// One answer read aloud by the server's voice (VOX-5), or nil when the
    /// phone's own voice should read it: spend near the cap, the voice not
    /// answering, offline. Never kept on the phone (CSEC-2).
    public func cookieSpeech(turnId: String) async -> Data? {
        guard let body = try? await api.getAssistantSpeech(path: .init(id: turnId)).ok.body.audioMpeg,
              let data = try? await Data(collecting: body, upTo: 2 * 1024 * 1024), !data.isEmpty
        else { return nil }
        return data
    }
}
