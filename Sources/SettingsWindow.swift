import Cocoa
import SwiftUI

protocol SettingsDelegate: AnyObject {
    func settingsDidChange()
}

// MARK: - UserDefaults Keys

enum SettingsKey {
    static let hotkey = "hotkey"
    static let txProvider = "txProvider"
    static let txApiKey = "txApiKey"
    static let txModel = "txModel"
    static let fmtProvider = "fmtProvider"
    static let fmtApiKey = "fmtApiKey"
    static let fmtModel = "fmtModel"
    static let fmtStyle = "fmtStyle"
    static let onboardingComplete = "onboardingComplete"
}

// MARK: - SwiftUI Settings View

struct SettingsView: View {
    @State private var hotkey: String

    // Transcription
    @State private var txProvider: String
    @State private var txApiKey: String
    @State private var txModel: String

    // Formatting
    @State private var fmtProvider: String
    @State private var fmtApiKey: String
    @State private var fmtModel: String
    @State private var fmtStyle: String
    @State private var fmtUseSameKey: Bool

    var onSave: (() -> Void)?
    var onCancel: (() -> Void)?

    init() {
        let d = UserDefaults.standard
        _hotkey = State(initialValue: d.string(forKey: SettingsKey.hotkey) ?? "fn")
        _txProvider = State(initialValue: d.string(forKey: SettingsKey.txProvider) ?? "none")
        _txApiKey = State(initialValue: d.string(forKey: SettingsKey.txApiKey) ?? "")
        _txModel = State(initialValue: d.string(forKey: SettingsKey.txModel) ?? "")
        _fmtProvider = State(initialValue: d.string(forKey: SettingsKey.fmtProvider) ?? "none")
        _fmtApiKey = State(initialValue: d.string(forKey: SettingsKey.fmtApiKey) ?? "")
        _fmtModel = State(initialValue: d.string(forKey: SettingsKey.fmtModel) ?? "")
        _fmtStyle = State(initialValue: d.string(forKey: SettingsKey.fmtStyle) ?? "formatted")

        let txKey = d.string(forKey: SettingsKey.txApiKey) ?? ""
        let fKey = d.string(forKey: SettingsKey.fmtApiKey) ?? ""
        _fmtUseSameKey = State(initialValue: fKey.isEmpty || fKey == txKey)
    }

    private var selectedTxProvider: TranscriptionProvider {
        TranscriptionProvider.allCases.first { $0.rawValue == txProvider } ?? .none
    }

    private var selectedFmtProvider: FormattingProvider {
        FormattingProvider.allCases.first { $0.rawValue == fmtProvider } ?? .none
    }

    private var selectedStyle: FormattingStyle {
        FormattingStyle.allCases.first { $0.rawValue == fmtStyle } ?? .formatted
    }

    private var hasTxProvider: Bool { selectedTxProvider != .none }
    private var hasFmtProvider: Bool { selectedFmtProvider != .none }

    var body: some View {
        VStack(spacing: 0) {
            Form {
                // General
                Section {
                    Picker("Hotkey", selection: $hotkey) {
                        Text("fn / Globe 🌐").tag("fn")
                        Text("Option ⌥").tag("option")
                    }
                    .pickerStyle(.menu)
                }

                // Transcription
                Section {
                    Picker("Provider", selection: $txProvider) {
                        ForEach(TranscriptionProvider.allCases, id: \.rawValue) { p in
                            Text(p.label).tag(p.rawValue)
                        }
                    }
                    .pickerStyle(.menu)

                    if hasTxProvider {
                        TextField("API Key", text: $txApiKey, prompt: Text("Required"))

                        TextField("Model", text: $txModel, prompt: Text(selectedTxProvider.defaultModel))
                    }
                } header: {
                    Text("Transcription")
                } footer: {
                    if !hasTxProvider {
                        Text("Using Apple's built-in dictation — free, on-device.")
                            .font(.caption).foregroundColor(.secondary)
                    }
                }

                // Formatting
                Section {
                    Picker("Provider", selection: $fmtProvider) {
                        ForEach(FormattingProvider.allCases, id: \.rawValue) { p in
                            Text(p.label).tag(p.rawValue)
                        }
                    }
                    .pickerStyle(.menu)

                    if hasFmtProvider {
                        let shareKey = fmtUseSameKey && hasTxProvider
                        TextField("API Key", text: shareKey ? $txApiKey : $fmtApiKey, prompt: Text("Required"))
                            .disabled(shareKey)

                        if hasTxProvider {
                            Toggle("Use same API key", isOn: $fmtUseSameKey)
                        }

                        TextField("Model", text: $fmtModel, prompt: Text(selectedFmtProvider.defaultModel))

                        Picker("Style", selection: $fmtStyle) {
                            ForEach(FormattingStyle.allCases, id: \.rawValue) { s in
                                Text(s.label).tag(s.rawValue)
                            }
                        }
                        .pickerStyle(.menu)

                        // Example preview
                        VStack(alignment: .leading, spacing: 6) {
                            Text("**\(selectedStyle.label)** — \(selectedStyle.description)")
                                .font(.caption).foregroundColor(.primary)
                            Divider()
                            Text("Input:").font(.caption2).foregroundColor(.secondary)
                            Text("\"\(FormattingStyle.exampleInput)\"")
                                .font(.caption).foregroundColor(.secondary).italic()
                            Text("Output:").font(.caption2).foregroundColor(.secondary).padding(.top, 2)
                            Text("\"\(selectedStyle.exampleOutput)\"")
                                .font(.caption).foregroundColor(.primary)
                        }
                        .padding(.vertical, 4)
                        .animation(.easeInOut(duration: 0.15), value: fmtStyle)
                    }
                } header: {
                    Text("Formatting")
                } footer: {
                    if !hasFmtProvider {
                        Text("No formatting — raw transcription will be pasted as-is.")
                            .font(.caption).foregroundColor(.secondary)
                    }
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .animation(.easeInOut(duration: 0.2), value: txProvider)
            .animation(.easeInOut(duration: 0.2), value: fmtProvider)

            // Buttons
            HStack {
                Button("Reset Onboarding") {
                    UserDefaults.standard.set(false, forKey: SettingsKey.onboardingComplete)
                    onSave?()
                }
                .foregroundColor(.secondary)
                Spacer()
                Button("Cancel") { onCancel?() }
                    .keyboardShortcut(.cancelAction)
                Button("Save") {
                    let d = UserDefaults.standard
                    d.set(hotkey, forKey: SettingsKey.hotkey)
                    d.set(txProvider, forKey: SettingsKey.txProvider)
                    d.set(txApiKey, forKey: SettingsKey.txApiKey)
                    d.set(txModel, forKey: SettingsKey.txModel)
                    d.set(fmtProvider, forKey: SettingsKey.fmtProvider)
                    d.set(fmtUseSameKey ? "" : fmtApiKey, forKey: SettingsKey.fmtApiKey)
                    d.set(fmtModel, forKey: SettingsKey.fmtModel)
                    d.set(fmtStyle, forKey: SettingsKey.fmtStyle)
                    onSave?()
                }
                .keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 16)
            .padding(.top, 4)
        }
        .frame(width: 480, height: 600)
    }
}

// MARK: - NSWindow wrapper

class SettingsWindow: NSWindow {
    weak var settingsDelegate: SettingsDelegate?

    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 600),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )

        title = "Yap Settings"
        isReleasedWhenClosed = false
        center()
        loadUI()
    }

    private func loadUI() {
        var settingsView = SettingsView()

        settingsView.onSave = { [weak self] in
            self?.settingsDelegate?.settingsDidChange()
            self?.close()
        }

        settingsView.onCancel = { [weak self] in
            self?.close()
        }

        contentView = NSHostingView(rootView: settingsView)
    }

    override func makeKeyAndOrderFront(_ sender: Any?) {
        loadUI()
        super.makeKeyAndOrderFront(sender)
    }

}
