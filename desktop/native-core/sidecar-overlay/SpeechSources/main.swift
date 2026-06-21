import AVFoundation
import Foundation
import Speech

enum HelperError: Error, CustomStringConvertible {
    case message(String)
    case timeout(TimeInterval)

    var description: String {
        switch self {
        case .message(let message):
            return message
        case .timeout(let seconds):
            return "SpeechAnalyzer timed out after \(String(format: "%.1f", seconds)) seconds"
        }
    }
}

func log(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

func fail(_ message: String, code: Int32 = 1) -> Never {
    log(message)
    exit(code)
}

func withTimeout<T: Sendable>(
    seconds: TimeInterval,
    operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask {
            try await operation()
        }
        group.addTask {
            let nanoseconds = UInt64(max(seconds, 0.1) * 1_000_000_000)
            try await Task.sleep(nanoseconds: nanoseconds)
            throw HelperError.timeout(seconds)
        }

        guard let result = try await group.next() else {
            throw HelperError.message("SpeechAnalyzer task ended without a result")
        }
        group.cancelAll()
        return result
    }
}

func statusLabel(_ status: AssetInventory.Status) -> String {
    switch status {
    case .unsupported:
        return "unsupported"
    case .supported:
        return "supported"
    case .downloading:
        return "downloading"
    case .installed:
        return "installed"
    @unknown default:
        return "unknown"
    }
}

func ensureSpeechAssets(
    for transcriber: SpeechTranscriber,
    localeIdentifier: String,
    timeoutSeconds: TimeInterval
) async throws {
    let status = await AssetInventory.status(forModules: [transcriber])
    log("asset_status=\(statusLabel(status))")

    switch status {
    case .installed:
        return
    case .unsupported:
        throw HelperError.message(
            "SpeechAnalyzer assets are unsupported for locale: \(localeIdentifier)"
        )
    case .downloading:
        throw HelperError.message(
            "SpeechAnalyzer speech assets for \(localeIdentifier) are still downloading. Try again when macOS finishes installing on-device speech assets."
        )
    case .supported:
        guard let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) else {
            throw HelperError.message(
                "SpeechAnalyzer speech assets for \(localeIdentifier) are not installed and no installation request is available."
            )
        }

        log("asset_status=installing")
        try await withTimeout(seconds: timeoutSeconds) {
            try await request.downloadAndInstall()
        }

        let installedStatus = await AssetInventory.status(forModules: [transcriber])
        log("asset_status=\(statusLabel(installedStatus))")
        guard installedStatus == .installed else {
            throw HelperError.message(
                "SpeechAnalyzer speech assets for \(localeIdentifier) are installing or unavailable. Current status: \(statusLabel(installedStatus))."
            )
        }
    @unknown default:
        throw HelperError.message(
            "SpeechAnalyzer speech asset status is unknown for locale: \(localeIdentifier)"
        )
    }
}

func transcribe(
    audioURL: URL,
    localeIdentifier: String,
    timeoutSeconds: TimeInterval
) async throws -> String {
    guard SpeechTranscriber.isAvailable else {
        throw HelperError.message("SpeechAnalyzer transcription is unavailable on this Mac")
    }

    let requestedLocale = Locale(identifier: localeIdentifier)
    guard let supportedLocale = await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale) else {
        throw HelperError.message("SpeechAnalyzer does not support locale: \(localeIdentifier)")
    }

    let file = try AVAudioFile(forReading: audioURL)
    let format = file.processingFormat
    let durationSeconds = Double(file.length) / format.sampleRate
    log(
        "audio_file=\(audioURL.path) locale=\(supportedLocale.identifier(.bcp47)) duration=\(String(format: "%.3f", durationSeconds))s sample_rate=\(String(format: "%.0f", format.sampleRate)) channels=\(format.channelCount)"
    )

    let transcriber = SpeechTranscriber(locale: supportedLocale, preset: .transcription)
    try await ensureSpeechAssets(
        for: transcriber,
        localeIdentifier: supportedLocale.identifier(.bcp47),
        timeoutSeconds: timeoutSeconds
    )

    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let resultTask = Task {
        var parts: [String] = []
        var finalCount = 0

        for try await result in transcriber.results {
            guard result.isFinal else {
                continue
            }

            let text = String(result.text.characters)
            finalCount += 1
            log("final_result index=\(finalCount) len=\(text.trimmingCharacters(in: .whitespacesAndNewlines).count)")
            parts.append(text)
        }

        return parts.joined()
    }

    do {
        let lastSample = try await analyzer.analyzeSequence(from: file)
        if lastSample != nil {
            try await analyzer.finalizeAndFinishThroughEndOfInput()
        } else {
            await analyzer.cancelAndFinishNow()
        }

        let transcript = try await resultTask.value
        log("completed len=\(transcript.trimmingCharacters(in: .whitespacesAndNewlines).count)")
        return transcript
    } catch {
        resultTask.cancel()
        await analyzer.cancelAndFinishNow()
        throw error
    }
}

@main
struct YapSpeech {
    static func main() async {
        guard CommandLine.arguments.count >= 3 else {
            fail("usage: yap-speech <wav-path> <locale> [timeout-seconds]")
        }

        let audioURL = URL(fileURLWithPath: CommandLine.arguments[1])
        let localeIdentifier = CommandLine.arguments[2]
        let timeoutSeconds = CommandLine.arguments.count >= 4
            ? Double(CommandLine.arguments[3]) ?? 30
            : 30

        guard FileManager.default.fileExists(atPath: audioURL.path) else {
            fail("audio file not found: \(audioURL.path)")
        }

        do {
            let transcript = try await withTimeout(seconds: timeoutSeconds) {
                try await transcribe(
                    audioURL: audioURL,
                    localeIdentifier: localeIdentifier,
                    timeoutSeconds: timeoutSeconds
                )
            }
            print(transcript)
            exit(0)
        } catch let error as HelperError {
            switch error {
            case .timeout:
                fail(error.description, code: 2)
            case .message:
                fail(error.description)
            }
        } catch {
            fail(error.localizedDescription)
        }
    }
}
