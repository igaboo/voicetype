import Foundation
import Speech

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

guard CommandLine.arguments.count >= 3 else {
    fail("usage: yap-speech <wav-path> <locale> [timeout-seconds]")
}

let audioURL = URL(fileURLWithPath: CommandLine.arguments[1])
let localeID = CommandLine.arguments[2]
let timeoutSeconds = CommandLine.arguments.count >= 4
    ? Double(CommandLine.arguments[3]) ?? 30
    : 30

guard FileManager.default.fileExists(atPath: audioURL.path) else {
    fail("audio file not found: \(audioURL.path)")
}

func authorizationLabel(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch status {
    case .notDetermined:
        return "notDetermined"
    case .denied:
        return "denied"
    case .restricted:
        return "restricted"
    case .authorized:
        return "authorized"
    @unknown default:
        return "unknown"
    }
}

func ensureAuthorized() -> SFSpeechRecognizerAuthorizationStatus {
    let status = SFSpeechRecognizer.authorizationStatus()
    if status != .notDetermined {
        return status
    }

    var nextStatus = status
    let semaphore = DispatchSemaphore(value: 0)
    SFSpeechRecognizer.requestAuthorization { requestedStatus in
        nextStatus = requestedStatus
        semaphore.signal()
    }

    _ = semaphore.wait(timeout: .now() + 30)
    return nextStatus
}

let authorization = ensureAuthorized()
FileHandle.standardError.write(Data("authorization=\(authorizationLabel(authorization))\n".utf8))
guard authorization == .authorized else {
    fail("speech recognition permission is \(authorizationLabel(authorization))")
}

guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeID)) else {
    fail("speech recognizer unavailable for locale: \(localeID)")
}

guard recognizer.isAvailable else {
    fail("speech recognizer is not available")
}

if #available(macOS 10.15, *) {
    guard recognizer.supportsOnDeviceRecognition else {
        fail("on-device speech recognition is not available for locale: \(localeID)")
    }
}

let request = SFSpeechURLRecognitionRequest(url: audioURL)
request.shouldReportPartialResults = true
if #available(macOS 10.15, *) {
    request.requiresOnDeviceRecognition = true
}

var latestText = ""
var finalText: String?
var failure: String?
var completed = false

let task = recognizer.recognitionTask(with: request) { result, error in
    if let result {
        latestText = result.bestTranscription.formattedString
        if result.isFinal {
            finalText = latestText
            completed = true
        }
    }

    if let error {
        failure = error.localizedDescription
        completed = true
    }
}

let deadline = Date().addingTimeInterval(timeoutSeconds)
while !completed && Date() < deadline {
    RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
}

task.cancel()

if let finalText {
    print(finalText)
    exit(0)
}

if !latestText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    print(latestText)
    exit(0)
}

if let failure {
    fail(failure)
}

fail("speech recognition timed out", code: 2)
