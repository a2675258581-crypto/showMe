// swift-tools-version:5.10
import PackageDescription

// ShowMeCore：纯逻辑（只依赖 Foundation），Linux 上也能编译测试。
// ShowMe：macOS 原生 App（SwiftUI + AppKit），只在 macOS 上参与构建。
var targets: [Target] = [
    .target(name: "ShowMeCore", path: "Sources/ShowMeCore"),
    .testTarget(name: "ShowMeCoreTests", dependencies: ["ShowMeCore"], path: "Tests/ShowMeCoreTests"),
]
var products: [Product] = [
    .library(name: "ShowMeCore", targets: ["ShowMeCore"]),
]

#if os(macOS)
targets.append(
    .executableTarget(
        name: "ShowMe",
        dependencies: ["ShowMeCore"],
        path: "Sources/ShowMe",
        linkerSettings: [
            .linkedFramework("AppKit"),
            .linkedFramework("JavaScriptCore"),
            .linkedFramework("CoreImage"),
            .linkedFramework("UniformTypeIdentifiers"),
            .linkedFramework("WebKit"),
        ]
    )
)
targets.append(.testTarget(name: "ShowMeTests", dependencies: ["ShowMe", "ShowMeCore"], path: "Tests/ShowMeTests"))
products.append(.executable(name: "ShowMe", targets: ["ShowMe"]))
#endif

let package = Package(
    name: "ShowMe",
    platforms: [.macOS(.v14)],
    products: products,
    targets: targets
)
