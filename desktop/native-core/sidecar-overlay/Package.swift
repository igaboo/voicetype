// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "yap-overlay",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "yap-overlay", targets: ["yap-overlay"]),
        .executable(name: "yap-speech", targets: ["yap-speech"]),
    ],
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
        ),
        .executableTarget(
            name: "yap-speech",
            path: "SpeechSources",
            swiftSettings: [
                .unsafeFlags(["-suppress-warnings"]),
            ],
            linkerSettings: [
                .linkedFramework("Foundation"),
                .linkedFramework("Speech"),
            ]
        )
    ]
)
