import SwiftUI

/// A screen that arrives in a later build.
struct ComingSoon: View {
    let title: String
    let systemImage: String

    var body: some View {
        ContentUnavailableView(title, systemImage: systemImage, description: Text("Coming in the next build. Use the website for now."))
            .navigationTitle(title)
    }
}
