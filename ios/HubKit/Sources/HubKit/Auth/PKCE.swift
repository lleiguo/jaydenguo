import CryptoKit
import Foundation

/// PKCE (RFC 7636, S256) between the app and the site (intent 0004, API-1).
public struct PKCE: Sendable, Equatable {
    public let verifier: String
    public var challenge: String { PKCE.challenge(for: verifier) }

    public init(verifier: String) { self.verifier = verifier }

    /// A fresh verifier: 32 random bytes, base64url (43 characters).
    public static func random() -> PKCE {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return PKCE(verifier: Data(bytes).base64URLEncoded())
    }

    public static func challenge(for verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded()
    }
}

extension Data {
    func base64URLEncoded() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
