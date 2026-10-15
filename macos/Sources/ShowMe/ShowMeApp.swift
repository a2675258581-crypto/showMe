import SwiftUI
import ShowMeCore

@main
struct ShowMeApp: App {
    var body: some Scene {
        Window("showMe", id: "main") {
            Text("showMe · \(ToolRegistry.all.count)")
                .frame(minWidth: 640, minHeight: 400)
        }
    }
}
