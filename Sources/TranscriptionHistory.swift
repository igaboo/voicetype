import Foundation

struct HistoryEntry: Codable, Identifiable {
    let id: UUID
    let timestamp: Date
    let text: String
    let transcriptionProvider: String
    let formattingProvider: String?
    let formattingStyle: String?
}

final class HistoryManager {
    static let shared = HistoryManager()

    private(set) var entries: [HistoryEntry] = []

    private var isEnabled: Bool {
        UserDefaults.standard.object(forKey: SettingsKey.historyEnabled) as? Bool ?? true
    }

    private var maxEntries: Int {
        let v = UserDefaults.standard.integer(forKey: SettingsKey.historyMaxEntries)
        return v == 0 ? 20 : v
    }

    private static var historyURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".config/yap/history.json")
    }

    init() { load() }

    func append(text: String, txProvider: String, fmtProvider: String?, fmtStyle: String?) {
        guard isEnabled else { return }
        let entry = HistoryEntry(
            id: UUID(),
            timestamp: Date(),
            text: text,
            transcriptionProvider: txProvider,
            formattingProvider: fmtProvider,
            formattingStyle: fmtStyle
        )
        entries.insert(entry, at: 0)
        if entries.count > maxEntries { entries = Array(entries.prefix(maxEntries)) }
        save()
    }

    func clear() {
        entries = []
        save()
    }

    private func load() {
        let url = Self.historyURL
        guard let data = try? Data(contentsOf: url) else { return }
        entries = (try? JSONDecoder().decode([HistoryEntry].self, from: data)) ?? []
    }

    private func save() {
        let url = Self.historyURL
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if let data = try? JSONEncoder().encode(entries) {
            try? data.write(to: url, options: .atomic)
        }
    }
}
