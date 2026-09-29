import SwiftUI

/// The calendar arrives in N3 (ICAL-1..7).
struct CalendarScreen: View {
    var body: some View {
        ComingSoon(title: "Calendar", systemImage: "calendar")
    }
}

struct ComingSoon: View {
    let title: String
    let systemImage: String

    var body: some View {
        ContentUnavailableView(title, systemImage: systemImage, description: Text("Coming in the next build. Use the website for now."))
            .navigationTitle(title)
    }
}
