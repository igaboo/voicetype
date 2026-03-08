import Cocoa

/// Monitors a modifier key (fn, Option, etc.) via CGEventTap.
/// Calls onKeyDown when the modifier is pressed and onKeyUp when released.
class HotkeyManager {
    var onKeyDown: () -> Void
    var onKeyUp: () -> Void
    var onDoubleTap: (() -> Void)?

    private let modifierMask: CGEventFlags
    private var eventTap: CFMachPort?
    private(set) var isHeld = false
    private var lastKeyUpTime: Date?
    private let doubleTapWindow: TimeInterval = 0.35
    /// Whether we're monitoring the fn/Globe key (vs Option, etc.)
    private let isFnKey: Bool

    init(modifierMask: UInt64, onKeyDown: @escaping () -> Void, onKeyUp: @escaping () -> Void) {
        self.modifierMask = CGEventFlags(rawValue: modifierMask)
        self.isFnKey = modifierMask == 0x00800000
        self.onKeyDown = onKeyDown
        self.onKeyUp = onKeyUp
    }

    /// Start the event tap. Returns false if accessibility permission is missing.
    func start() -> Bool {
        // Intercept flagsChanged + keyDown/keyUp (to suppress fn/Globe emoji picker)
        let mask: CGEventMask = (1 << CGEventType.flagsChanged.rawValue)
            | (1 << CGEventType.keyDown.rawValue)
            | (1 << CGEventType.keyUp.rawValue)
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()

        // Try HID-level tap first — intercepts before the emoji picker sees events.
        // Falls back to session-level tap if HID tap isn't available.
        let tap: CFMachPort
        if let hidTap = CGEvent.tapCreate(
            tap: .cghidEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: hotkeyCallback,
            userInfo: selfPtr
        ) {
            tap = hidTap
        } else if let sessionTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .defaultTap,
            eventsOfInterest: mask,
            callback: hotkeyCallback,
            userInfo: selfPtr
        ) {
            tap = sessionTap
        } else {
            return false
        }

        eventTap = tap
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }

    func stop() {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
            eventTap = nil
        }
    }

    fileprivate func handleEvent(type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        // Re-enable if system disabled the tap
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap = eventTap {
                CGEvent.tapEnable(tap: tap, enable: true)
            }
            return Unmanaged.passUnretained(event)
        }

        // Suppress fn/Globe keyDown/keyUp that trigger the emoji picker.
        // Always consume keycode 63/179 when fn is our hotkey — don't wait for isHeld,
        // since the keyDown may arrive before the flagsChanged event.
        if type == .keyDown || type == .keyUp {
            if isFnKey {
                let keycode = event.getIntegerValueField(.keyboardEventKeycode)
                if keycode == 63 || keycode == 179 {
                    return nil
                }
            }
            return Unmanaged.passUnretained(event)
        }

        guard type == .flagsChanged else {
            return Unmanaged.passUnretained(event)
        }

        let flags = event.flags
        let triggerActive = flags.contains(modifierMask)

        // Only trigger if no other modifiers are held (don't steal fn+arrows, option+letter, etc.)
        let otherModifiers: CGEventFlags = [.maskShift, .maskControl, .maskAlternate, .maskCommand]
        let relevantOthers = flags.intersection(otherModifiers).subtracting(modifierMask)
        let hasOtherModifiers = !relevantOthers.isEmpty

        if triggerActive && !hasOtherModifiers && !isHeld {
            isHeld = true
            if let lastUp = lastKeyUpTime, Date().timeIntervalSince(lastUp) < doubleTapWindow {
                lastKeyUpTime = nil
                DispatchQueue.main.async { self.onDoubleTap?() }
            } else {
                DispatchQueue.main.async { self.onKeyDown() }
            }
            return nil // consume event (suppress system fn/option behavior)
        } else if !triggerActive && isHeld {
            isHeld = false
            lastKeyUpTime = Date()
            DispatchQueue.main.async { self.onKeyUp() }
            return nil // consume release too
        }

        return Unmanaged.passUnretained(event)
    }
}

/// Global C callback for the event tap — forwards to HotkeyManager instance.
private func hotkeyCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let refcon = refcon else { return Unmanaged.passUnretained(event) }
    let manager = Unmanaged<HotkeyManager>.fromOpaque(refcon).takeUnretainedValue()
    return manager.handleEvent(type: type, event: event)
}
