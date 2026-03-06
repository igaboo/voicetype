import Cocoa
import SwiftUI

/// A floating pill-shaped overlay at the bottom of the screen
/// with audio-reactive waveform bars and a processing spinner.
class OverlayPanel: NSPanel {
    private let overlayState = OverlayState()
    private var errorDismissWork: DispatchWorkItem?

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    
    init() {
        let width: CGFloat = 1400
        let height: CGFloat = 700

        let screenFrame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let x = screenFrame.midX - width / 2
        let y = screenFrame.minY + 330 - height
        
        super.init(
            contentRect: NSRect(x: x, y: y, width: width, height: height),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        
        level = .floating
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false // no window-level shadow, SwiftUI handles it
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        isMovableByWindowBackground = false
        hidesOnDeactivate = false
        ignoresMouseEvents = true // clicks pass through entirely
        
        let hostingView = NSHostingView(rootView:
            OverlayView(state: overlayState)
                .frame(width: width, height: height)
        )
        contentView = hostingView
    }
    
    func showRecording() {
        errorDismissWork?.cancel()
        errorDismissWork = nil
        overlayState.audioLevel = 0
        alphaValue = 1
        orderFront(nil)
        withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.5)) {
            overlayState.mode = .recording
        }
    }

    func updateLevel(_ level: Float) {
        overlayState.audioLevel = level
    }

    func updateBandLevels(_ levels: [Float]) {
        overlayState.bandLevels = levels
    }

    func showProcessing() {
        overlayState.mode = .processing
    }

    func showError(_ message: String) {
        overlayState.mode = .error(message)
        errorDismissWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            self?.dismiss()
        }
        errorDismissWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0, execute: work)
    }

    func dismiss() {
        withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.35)) {
            overlayState.mode = .idle
        }
    }

    var currentOnboardingStep: OnboardingStep? {
        overlayState.onboardingStep
    }

    func advanceOnboarding(to step: OnboardingStep) {
        ignoresMouseEvents = true
        withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.5)) {
            overlayState.onboardingStep = step
        }
    }

    func setHotkeyLabel(_ label: String) {
        overlayState.hotkeyLabel = label
    }

    func showNoSpeech() {
        withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.35)) {
            overlayState.mode = .noSpeech
        }
        shake()
    }

    func shake() {
        overlayState.shakeToken = UUID()
    }

    func pressDown() {
        withAnimation(.spring(response: 0.2, dampingFraction: 0.7)) {
            overlayState.isPressed = true
        }
    }

    func pressRelease() {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.5)) {
            overlayState.isPressed = false
        }
    }

    func completeOnboarding() {
        ignoresMouseEvents = true
        withAnimation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.35)) {
            overlayState.onboardingStep = nil
        }
    }

}

// MARK: - State

enum OverlayMode: Equatable {
    case idle, recording, processing, noSpeech, error(String)
}

struct ShakeEffect: GeometryEffect {
    var progress: CGFloat = 0

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        let offset = 10 * sin(progress * .pi * 6) * (1 - progress)
        return ProjectionTransform(CGAffineTransform(translationX: offset, y: 0))
    }
}

enum OnboardingStep: Hashable {
    case tryIt
    case success(String)
    case apiTip
    case formattingTip
    case welcome
    case speakTip
    case holdTip
}

class OverlayState: ObservableObject {
    @Published var mode: OverlayMode = .idle
    @Published var audioLevel: Float = 0
    @Published var bandLevels: [Float] = Array(repeating: 0, count: 11)
    @Published var onboardingStep: OnboardingStep? = nil
    @Published var hotkeyLabel: String = "fn"
    @Published var shakeToken: UUID = UUID()
    @Published var isPressed: Bool = false
    var isOnboarding: Bool { onboardingStep != nil }
}

// MARK: - SwiftUI Views

struct OverlayView: View {
    @ObservedObject var state: OverlayState
    @State private var shakeProgress: CGFloat = 0

    private var isActive: Bool { state.mode != .idle || state.isOnboarding }
    private var isExpanded: Bool { state.mode != .idle || state.isOnboarding }

    private var gradientEnergy: CGFloat {
        switch state.mode {
        case .recording:
            return 1.0
        case .processing:
            return 0.6
        default:
            return state.isOnboarding ? 0.3 : 0.4
        }
    }

    private var audioBounceFactor: CGFloat {
        guard state.mode == .recording else { return 1.0 }
        let level = min(CGFloat(state.audioLevel), 1.0)
        return 1.0 + pow(level, 1.5) * 0.25
    }

    var body: some View {
        ZStack {
            if isExpanded {
                LavaLampBackground(energy: gradientEnergy)
                    .transition(.opacity)
                    .animation(.easeInOut(duration: 0.8), value: gradientEnergy)
            }

            VStack(spacing: 0) {
                Spacer()
                    .frame(height: 265)

                ZStack {
                    if isActive {
                        pillContent
                            .transition(.opacity)
                    }
                }
                .fixedSize()
                .frame(minWidth: 40, minHeight: isExpanded ? 28 : 8)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    ZStack {
                        Capsule()
                            .fill(Color.black.opacity(isExpanded ? 0.75 : 0.4))
                        Capsule()
                            .fill(.thinMaterial)
                    }
                    .shadow(color: .black.opacity(isExpanded ? 0.35 : 0.1), radius: isExpanded ? 16 : 6, y: isExpanded ? 4 : 2)
                )
                .overlay(
                    Capsule()
                        .strokeBorder(Color.white.opacity(isExpanded ? 0.3 : 0.35), lineWidth: isExpanded ? 1 : 1.5)
                )
                .scaleEffect((isExpanded ? 1.0 : 0.5) * audioBounceFactor * (state.isPressed ? 0.85 : 1.0))
                .opacity(state.isPressed ? 0.7 : 1.0)
                .offset(y: isExpanded ? 0 : 40)
                .modifier(ShakeEffect(progress: shakeProgress))
                .animation(.spring(response: 0.25, dampingFraction: 0.45, blendDuration: 0.05), value: state.audioLevel)
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: state.onboardingStep)
                .animation(.spring(response: 0.4, dampingFraction: 0.8), value: state.mode)
                .overlay(alignment: .bottom) {
                    if let step = state.onboardingStep,
                       state.mode == .idle || state.mode == .noSpeech {
                        OnboardingCardView(step: step, hotkeyLabel: state.hotkeyLabel)
                            .id(step)
                            .fixedSize()
                            .offset(y: -56)
                            .transition(.opacity.combined(with: .offset(y: 8)))
                    }
                }

                Spacer()
            }
        }
        .onChange(of: state.shakeToken) { _ in
            shakeProgress = 0
            withAnimation(.easeOut(duration: 0.5)) {
                shakeProgress = 1
            }
        }
    }

    private var showHoldPromptInPill: Bool {
        guard let step = state.onboardingStep, state.mode == .idle || state.mode == .noSpeech else { return false }
        switch step {
        case .success, .apiTip, .formattingTip, .welcome:
            return true
        default:
            return false
        }
    }

    @ViewBuilder
    private var pillContent: some View {
        if showHoldPromptInPill {
            HStack(spacing: 6) {
                Text("Hold")
                KeyCapView(label: state.hotkeyLabel)
                Text(state.onboardingStep == .welcome ? "to finish" : "to continue")
            }
            .font(.system(size: 12, weight: .medium))
            .foregroundColor(.white.opacity(0.8))
            .transition(.opacity)
        } else {
            switch state.mode {
            case .recording, .processing:
                WaveformBars(level: CGFloat(state.audioLevel), bandLevels: state.bandLevels, isProcessing: state.mode == .processing)
                    .frame(width: 52, height: 28)
                    .transition(.opacity)
            case .noSpeech:
                HStack(spacing: 2) {
                    ForEach(0..<11, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(Color.white.opacity(0.25))
                            .frame(width: 3, height: 5)
                    }
                }
                .frame(width: 52, height: 28)
                .transition(.opacity)
            case .error(let message):
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundColor(.red)
                        .font(.system(size: 12))
                    Text(message)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                }
                .transition(.opacity)
            case .idle:
                if state.isOnboarding {
                    HStack(spacing: 2) {
                        ForEach(0..<11, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: 1.5)
                                .fill(Color.white.opacity(0.25))
                                .frame(width: 3, height: 5)
                        }
                    }
                    .frame(width: 52, height: 28)
                    .transition(.opacity)
                } else {
                    EmptyView()
                }
            }
        }
    }
}

// MARK: - Onboarding Views

struct LavaLampBackground: View {
    var energy: CGFloat // 0 = calm, 1 = active

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let speed = 0.4 + energy * 0.6
            let brightness = 0.25 + energy * 0.25

            ZStack {
                Ellipse()
                    .fill(Color.purple.opacity(brightness))
                    .frame(width: 300, height: 140)
                    .offset(x: cos(t * 0.7 * speed) * 120, y: sin(t * 0.5 * speed) * 35)

                Ellipse()
                    .fill(Color.blue.opacity(brightness * 0.9))
                    .frame(width: 360, height: 160)
                    .offset(x: sin(t * 0.6 * speed + 1.5) * 140, y: cos(t * 0.45 * speed + 1.0) * 40)

                Ellipse()
                    .fill(Color.cyan.opacity(brightness * 0.85))
                    .frame(width: 280, height: 120)
                    .offset(x: cos(t * 0.8 * speed + 3.0) * 100, y: sin(t * 0.6 * speed + 2.0) * 30)

                Ellipse()
                    .fill(Color.indigo.opacity(brightness * 0.9))
                    .frame(width: 320, height: 130)
                    .offset(x: sin(t * 0.55 * speed + 4.5) * 130, y: cos(t * 0.7 * speed + 3.5) * 35)
            }
            .blur(radius: 55)
        }
    }
}

struct KeyCapView: View {
    let label: String

    var body: some View {
        Text(label)
            .font(.system(size: 12, weight: .semibold, design: .rounded))
            .foregroundColor(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(Color(white: 0.25))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5)
                    .strokeBorder(Color(white: 0.45), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.5), radius: 1, y: 1)
    }
}

struct OnboardingCardView: View {
    let step: OnboardingStep
    var hotkeyLabel: String = "fn"

    var body: some View {
        Group {
            switch step {
            case .tryIt:
                HStack(spacing: 6) {
                    Text("Hold")
                    KeyCapView(label: hotkeyLabel)
                    Text("and speak to get started")
                }
            case .success(let text):
                VStack(spacing: 6) {
                    Text("You said:")
                        .foregroundColor(.white.opacity(0.6))
                    Text("\"\(text)\"")
                        .italic()
                        .multilineTextAlignment(.center)
                }
            case .apiTip:
                Text("Add an API key in the menu bar for better transcription")
                    .multilineTextAlignment(.center)
            case .formattingTip:
                Text("Enable formatting in Settings to clean up grammar and punctuation automatically")
                    .multilineTextAlignment(.center)
            case .welcome:
                Text("You're all set — enjoy! 🎉")
                    .multilineTextAlignment(.center)
            case .speakTip:
                HStack(spacing: 6) {
                    Text("Didn't catch that — speak up while holding")
                    KeyCapView(label: hotkeyLabel)
                }
            case .holdTip:
                HStack(spacing: 6) {
                    Text("Hold")
                    KeyCapView(label: hotkeyLabel)
                    Text("— don't just tap it")
                }
            }
        }
        .font(.system(size: 15, weight: .medium))
        .foregroundColor(.white)
        .shadow(color: .black.opacity(0.4), radius: 4, y: 1)
    }
}

// MARK: - Waveform

struct WaveformBars: View {
    var level: CGFloat
    var bandLevels: [Float]
    var isProcessing: Bool
    let barCount = 11
    
    var body: some View {
        if isProcessing {
            WaveAnimationBars(lastLevel: level, barCount: barCount)
        } else {
            AudioReactiveBars(bandLevels: bandLevels, barCount: barCount)
        }
    }
}

// MARK: - Recording: lightweight, no TimelineView
struct AudioReactiveBars: View {
    var bandLevels: [Float]
    let barCount: Int
    
    // Position scaling — center emphasis, edges still move
    private let positionScale: [CGFloat] = [0.35, 0.45, 0.6, 0.78, 0.92, 1.0, 0.94, 0.8, 0.63, 0.48, 0.38]
    
    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<barCount, id: \.self) { index in
                let bandLevel = index < bandLevels.count ? CGFloat(bandLevels[index]) : 0
                // FFT variation: offset each bar's level by its band data
                let bandOffset = index < bandLevels.count ? CGFloat(bandLevels[index]) : 0
                // Blend: 70% overall volume + 30% per-band FFT variation
                let overall = bandLevels.isEmpty ? bandLevel : CGFloat(bandLevels.reduce(Float(0), +) / Float(bandLevels.count))
                let blended = overall * 0.7 + bandOffset * 0.3
                
                let scale = positionScale[index]
                
                let minH: CGFloat = 5
                let maxH: CGFloat = 28
                let barCeiling = minH + (maxH - minH) * scale
                
                // Scale so bars max out at ~75% volume, clamp at 1.0
                let scaled = min(blended / 0.75, 1.0)
                let driven = pow(scaled, 0.6)
                let barHeight = max(minH, min(barCeiling, minH + (barCeiling - minH) * driven))
                
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(Color.white.opacity(0.9))
                    .frame(width: 3, height: barHeight)
                    .animation(.easeOut(duration: 0.1), value: blended)
            }
        }
    }
}

// MARK: - Processing: TimelineView for wave animation
struct WaveAnimationBars: View {
    let lastLevel: CGFloat
    let barCount: Int
    
    @State private var displayLevel: CGFloat = 1
    @State private var waveStrength: CGFloat = 0
    @State private var startTime: Date? = nil
    
    var body: some View {
        TimelineView(.animation) { timeline in
            let elapsed = startTime.map { timeline.date.timeIntervalSince($0) } ?? 0
            // Sweep from well off-left to well off-right so the wave
            // fully exits before looping. With gaussian width 6.0,
            // need ~5 units of margin for the tail to fully disappear.
            let margin = 5.0
            let sweepRange = Double(barCount - 1) + margin * 2
            let t = elapsed.truncatingRemainder(dividingBy: 1.2) / 1.2
            let waveCenter = -margin + t * sweepRange
            
            HStack(spacing: 2) {
                ForEach(0..<barCount, id: \.self) { index in
                    // Audio-reactive base (decaying via displayLevel)
                    let center = CGFloat(barCount - 1) / 2.0
                    let distFromCenter = abs(CGFloat(index) - center) / center
                    let positionScale = 1.0 - (distFromCenter * 0.5)
                    let boosted = pow(lastLevel * displayLevel, 0.5)
                    let audioH = max(6.0, min(28.0, 6.0 + 22.0 * boosted * positionScale))
                    
                    // Wave overlay — very wide and gentle rolling wave
                    let distance = abs(Double(index) - waveCenter)
                    let wave = exp(-distance * distance / 6.0)
                    let waveH = 14.0 * CGFloat(wave) * waveStrength
                    
                    let barHeight = min(28.0, max(6.0, audioH + waveH))
                    
                    // Shimmer: opacity pulses with the wave — bright at peak, dim at rest
                    let dimOpacity = 0.35
                    let brightOpacity = 0.95
                    let shimmer = dimOpacity + (brightOpacity - dimOpacity) * Double(wave) * Double(waveStrength)
                    // When wave hasn't faded in yet, keep full opacity
                    let opacity = waveStrength > 0 ? shimmer : 0.9
                    
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(Color.white.opacity(opacity))
                        .frame(width: 3, height: barHeight)
                }
            }
        }
        .onAppear {
            startTime = Date()
            displayLevel = 1
            waveStrength = 0
            withAnimation(.easeOut(duration: 0.35)) {
                displayLevel = 0
            }
            withAnimation(.easeIn(duration: 0.35).delay(0.15)) {
                waveStrength = 1
            }
        }
    }
}
