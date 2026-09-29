// swift-tools-version: 6.0
// HubKit: everything in the iPhone app that isn't a view (intent 0004, spec
// §4.1), shared by the app and its extensions and tested without a
// simulator. HubAPI is generated from the repository's openapi.json.
import PackageDescription

let package = Package(
    name: "HubKit",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "HubKit", targets: ["HubKit"]),
        .library(name: "HubAPI", targets: ["HubAPI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.10.0"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.1.0"),
        .package(url: "https://github.com/apple/swift-http-types", from: "1.3.0"),
    ],
    targets: [
        .target(
            name: "HubAPI",
            dependencies: [.product(name: "OpenAPIRuntime", package: "swift-openapi-runtime")],
            plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]
        ),
        .target(
            name: "HubKit",
            dependencies: [
                "HubAPI",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ]
        ),
        .testTarget(name: "HubKitTests", dependencies: ["HubKit"], resources: [.copy("Fixtures")]),
    ]
)
