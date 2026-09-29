import HubKit
import SwiftUI

/// A screen's data: loading, loaded, or failed with words to show.
enum Loadable<Value> {
    case loading
    case loaded(Value)
    case failed(String)

    var value: Value? {
        if case .loaded(let v) = self { v } else { nil }
    }
}

/// Runs a load and turns failures into readable messages.
@MainActor
func load<Value>(_ work: () async throws -> Value) async -> Loadable<Value> {
    do {
        return .loaded(try await work())
    } catch let error as HubError {
        return .failed(error.message)
    } catch let error as URLError where error.code == .notConnectedToInternet || error.code == .networkConnectionLost {
        return .failed(HubError.offline.message)
    } catch {
        return .failed("Couldn't load this. Pull to try again.")
    }
}

struct LoadableView<Value, Content: View>: View {
    let state: Loadable<Value>
    @ViewBuilder let content: (Value) -> Content

    var body: some View {
        switch state {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(message))
        case .loaded(let value):
            content(value)
        }
    }
}
