import CoreAudio
import Foundation

/// Lowers the system output volume while recording to reduce background noise picked up by the microphone,
/// then restores it when recording stops. Uses CoreAudio to manipulate the default output device volume.
class SystemAudioDucker {
    private var savedVolume: Float?
    private var isDucked = false
    private let duckLevel: Float = 0.05

    /// Lower the system output volume for cleaner speech capture.
    func duck() {
        guard !isDucked else { return }

        guard let deviceID = defaultOutputDeviceID() else {
            log("AudioDucker: no output device found")
            return
        }

        if let current = getVolume(device: deviceID) {
            savedVolume = current
            setVolume(device: deviceID, volume: duckLevel)
            isDucked = true
            log("AudioDucker: ducked \(String(format: "%.0f%%", current * 100)) -> \(String(format: "%.0f%%", duckLevel * 100))")
        }
    }

    /// Restore the system output volume to its previous level.
    func restore() {
        guard isDucked else { return }

        guard let deviceID = defaultOutputDeviceID(),
              let volume = savedVolume else {
            isDucked = false
            savedVolume = nil
            return
        }

        setVolume(device: deviceID, volume: volume)
        log("AudioDucker: restored to \(String(format: "%.0f%%", volume * 100))")
        isDucked = false
        savedVolume = nil
    }

    // MARK: - CoreAudio helpers

    private func defaultOutputDeviceID() -> AudioDeviceID? {
        var deviceID = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID
        )
        return status == noErr ? deviceID : nil
    }

    private func getVolume(device: AudioDeviceID) -> Float? {
        var volume: Float = 0
        var size = UInt32(MemoryLayout<Float>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain
        )
        let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &volume)
        return status == noErr ? volume : nil
    }

    private func setVolume(device: AudioDeviceID, volume: Float) {
        var vol = volume
        var size = UInt32(MemoryLayout<Float>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectSetPropertyData(device, &address, 0, nil, size, &vol)
    }
}
