import Foundation
import HubAPI
import Testing
@testable import HubKit

/// Talking to Cookie (intent 0007, plan K6.1): the rules behind press and
/// hold, the level ring and what is read aloud.
@Suite struct CookieVoiceTests {
    let client = testClient()

    @Test func liftingTheFingerTapsSendsOrCancels() {
        // Before recording started it was a tap (CK-4), unless the finger left.
        #expect(CookieVoice.release(recordedFor: nil, inside: true) == .tap)
        #expect(CookieVoice.release(recordedFor: nil, inside: false) == .cancel)
        // CK-2: too short is thrown away; sliding off cancels however long it was.
        #expect(CookieVoice.release(recordedFor: 0.3, inside: true) == .tooShort)
        #expect(CookieVoice.release(recordedFor: 0.5, inside: true) == .send)
        #expect(CookieVoice.release(recordedFor: 12, inside: true) == .send)
        #expect(CookieVoice.release(recordedFor: 12, inside: false) == .cancel)
    }

    @Test func aWobbleOnTheButtonIsStillInside() {
        #expect(CookieVoice.isInside(x: 26, y: 26, size: 52))
        #expect(CookieVoice.isInside(x: -20, y: 70, size: 52))
        #expect(!CookieVoice.isInside(x: -60, y: 26, size: 52))
        #expect(!CookieVoice.isInside(x: 26, y: -120, size: 52))
    }

    @Test func theLevelRingGoesFromSilenceToFull() {
        #expect(CookieVoice.level(decibels: -160) == 0)
        #expect(CookieVoice.level(decibels: -50) == 0)
        #expect(CookieVoice.level(decibels: -25) == 0.5)
        #expect(CookieVoice.level(decibels: 0) == 1)
        #expect(CookieVoice.level(decibels: 3) == 1)
        #expect(CookieVoice.level(decibels: .nan) == 0)
    }

    @Test func aRecordingIsSentAsBase64WithItsType() throws {
        let clip = Data([0, 0, 0, 24, 102, 116, 121, 112])
        guard case .json(let body) = CookieVoice.body(clip: clip, conversationId: "c1") else {
            Issue.record("not JSON")
            return
        }
        #expect(body.conversationId == "c1")
        #expect(body.text == nil)
        #expect(body.audio?.mimeType == "audio/mp4")
        #expect(Data(base64Encoded: try #require(body.audio?.data)) == clip)
    }

    @Test func aSpokenQuestionShowsWhatSheHeard() async throws {
        let answer = try await client.api.askAssistant(body: .json(.init(text: "Hi Cookie"))).ok.body.json
        let messages = CookieChat.messages(spoken: answer)
        #expect(messages.map(\.role) == [.you, .cookie])
        #expect(messages[0].text == "Hi Cookie")
        #expect(messages[1].id == answer.turnId)
        #expect(Set(messages.map(\.id)).count == 2)

        // Nothing heard: only her "I didn't catch that".
        var unheard = answer
        unheard.heard = ""
        #expect(CookieChat.messages(spoken: unheard).map(\.role) == [.cookie])
    }

    @Test func linksAreNotReadOutAndTheWebIsNamed() {
        #expect(CookieVoice.spokenText("Swim practice at 5:30 pm.") == "Swim practice at 5:30 pm.")
        #expect(CookieVoice.spokenText("Opens at 9. https://pool.example/hours", fromWeb: true, language: "en") == "From the web: Opens at 9.")
        #expect(CookieVoice.spokenText("九点开门。", fromWeb: true, language: "zh") == "网上说：九点开门。")
        #expect(CookieVoice.spokenText("**Bold** and `code`") == "Bold and code")
        #expect(CookieVoice.spokenText(" https://only.example/link ", fromWeb: true).isEmpty)
    }

    @Test func thePhoneVoiceMatchesTheAnswersLanguage() {
        #expect(CookieVoice.voiceLanguage("en") == "en-US")
        #expect(CookieVoice.voiceLanguage("zh") == "zh-CN")
        #expect(CookieVoice.voiceLanguage("mixed") == "zh-CN")
        #expect(CookieVoice.voiceLanguage(nil) == "en-US")
    }

    @Test func nothingIsReadWhenSpokenAnswersAreOff() async throws {
        let answer = try await client.api.askAssistant(body: .json(.init(text: "Hi Cookie"))).ok.body.json
        #expect(CookieVoice.speaks(answer, spokenAnswers: true))
        #expect(!CookieVoice.speaks(answer, spokenAnswers: false))
    }

    @Test func theClockCountsSeconds() {
        #expect(CookieVoice.clock(0) == "0:00")
        #expect(CookieVoice.clock(7.9) == "0:07")
        #expect(CookieVoice.clock(30) == "0:30")
        #expect(CookieVoice.clock(75) == "1:15")
    }

    /// A turn with no words heard has no question bubble in the history either.
    @Test func historySkipsAnEmptyQuestion() async throws {
        var turns = try await client.api.listAssistantTurns().ok.body.json.turns
        turns[0].heard = ""
        let messages = CookieChat.messages(turns)
        #expect(messages.first?.role == .cookie)
        #expect(messages.count == turns.count * 2 - 1)
    }
}
