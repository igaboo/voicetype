// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "yap-overlay",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "yap-overlay",
            path: "Sources",
            swiftSettings: [
                .unsafeFlags(["-suppress-warnings"]),
            ],
            linkerSettings: [
                .linkedFramework("Cocoa"),
            ]
        )
    ]
)
