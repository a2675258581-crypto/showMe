import AppKit
import ShowMeCore
import SwiftUI

/// 纸感极简（方案 E）调色板：暖白纸面、墨色文字、单一强调色。浅色 / 深色各一套，随系统切换。
enum PaperAccent: String, CaseIterable, Identifiable {
    case terracotta, pine, indigo, ochre

    var id: String { rawValue }

    var light: NSColor {
        switch self {
        case .terracotta: NSColor(hex: 0xB5452A)
        case .pine: NSColor(hex: 0x2F6F5E)
        case .indigo: NSColor(hex: 0x3557A6)
        case .ochre: NSColor(hex: 0x8A5A00)
        }
    }

    var dark: NSColor {
        switch self {
        case .terracotta: NSColor(hex: 0xE0795C)
        case .pine: NSColor(hex: 0x6CB59E)
        case .indigo: NSColor(hex: 0x8CA6E6)
        case .ochre: NSColor(hex: 0xD9A54A)
        }
    }

    var name: LocalizedText {
        switch self {
        case .terracotta: LocalizedText("赭红", "Terracotta")
        case .pine: LocalizedText("松绿", "Pine")
        case .indigo: LocalizedText("靛蓝", "Indigo")
        case .ochre: LocalizedText("赭黄", "Ochre")
        }
    }
}

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }

    /// 随外观自动切换的颜色（AppKit 在绘制时解析，切换深浅色无需重设）
    static func paper(_ light: NSColor, _ dark: NSColor) -> NSColor {
        NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        }
    }

    static func paper(_ light: UInt32, _ dark: UInt32) -> NSColor {
        paper(NSColor(hex: light), NSColor(hex: dark))
    }
}

/// 全部颜色都是动态 NSColor，SwiftUI 里通过 `Color(nsColor:)` 使用。
enum Ink {
    static let desk = NSColor.paper(0xCBC4B8, 0x141210)
    static let paper = NSColor.paper(0xFAF7F1, 0x1D1A17)
    static let drawer = NSColor.paper(0xF2EDE4, 0x24201C)
    static let well = NSColor.paper(0xEFE9DE, 0x2A2621)
    static let rule = NSColor.paper(0xDDD5C7, 0x3A342D)
    static let mark = NSColor.paper(0xF5DCCB, 0x5A3424)
    static let text = NSColor.paper(0x211D18, 0xF1EBE1)
    static let text2 = NSColor.paper(0x3B352D, 0xD6CEC2)
    static let text3 = NSColor.paper(0x7A7266, 0x9B9183)
    static let hover = NSColor.paper(NSColor(hex: 0x211D18, alpha: 0.06), NSColor(hex: 0xF1EBE1, alpha: 0.07))
    static let warning = NSColor.paper(0xA33A1F, 0xEC8B6E)

    @MainActor
    static var accent: NSColor {
        let a = AppSettings.shared.accent
        return .paper(a.light, a.dark)
    }

    // 语法高亮：几种「墨水」颜色，饱和度克制，和纸面协调
    static let keyword = NSColor.paper(0x9B3D24, 0xE58A6C)
    static let string = NSColor.paper(0x3D6B4F, 0x93C6A2)
    static let number = NSColor.paper(0x8A5A00, 0xE0B25C)
    static let comment = NSColor.paper(0x958C7E, 0x847B6F)
    static let property = NSColor.paper(0x2F5597, 0x92B2E8)
    static let type = NSColor.paper(0x6B4C9A, 0xBCA3E3)
    static let function = NSColor.paper(0x5B3A1E, 0xE8C9A6)
    static let punctuation = NSColor.paper(0x8A8173, 0x8F8679)
    static let meta = NSColor.paper(0x7A7266, 0x9B9183)
    static let inserted = NSColor.paper(0x3D6B4F, 0x93C6A2)
    static let deleted = NSColor.paper(0xA33A1F, 0xEC8B6E)
    static let invalid = NSColor.paper(0xC0392B, 0xFF6B57)
}

extension Color {
    static let desk = Color(nsColor: Ink.desk)
    static let paper = Color(nsColor: Ink.paper)
    static let drawer = Color(nsColor: Ink.drawer)
    static let well = Color(nsColor: Ink.well)
    static let rule = Color(nsColor: Ink.rule)
    static let mark = Color(nsColor: Ink.mark)
    static let ink = Color(nsColor: Ink.text)
    static let ink2 = Color(nsColor: Ink.text2)
    static let ink3 = Color(nsColor: Ink.text3)
    static let hover = Color(nsColor: Ink.hover)
    static let warningInk = Color(nsColor: Ink.warning)

    @MainActor
    static var accentInk: Color { Color(nsColor: Ink.accent) }
}

enum PaperFont {
    /// 标题用衬线：New York（系统自带）→ 宋体
    static func serif(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    static func mono(_ size: CGFloat) -> Font {
        .system(size: size, design: .monospaced)
    }

    static func nsSerif(_ size: CGFloat, bold: Bool = true) -> NSFont {
        let base = NSFont.systemFont(ofSize: size, weight: bold ? .bold : .regular)
        if let descriptor = base.fontDescriptor.withDesign(.serif), let font = NSFont(descriptor: descriptor, size: size) {
            return font
        }
        return base
    }
}

// MARK: - 通用小组件

/// 纸面风格的文字按钮：无边框，悬停时出现淡淡的底色
@MainActor
struct PaperButtonStyle: ButtonStyle {
    var prominent = false
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        PaperButtonBody(configuration: configuration, prominent: prominent, compact: compact)
    }

    @MainActor
    private struct PaperButtonBody: View {
        let configuration: ButtonStyleConfiguration
        let prominent: Bool
        let compact: Bool
        @State private var hovering = false
        @Environment(\.isEnabled) private var isEnabled

        var body: some View {
            configuration.label
                .font(.system(size: compact ? 12 : 12.5, weight: prominent ? .semibold : .regular))
                .foregroundStyle(prominent ? Color.white : Color.ink2)
                .padding(.horizontal, compact ? 8 : 12)
                .frame(height: compact ? 24 : 30)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(prominent ? Color.accentInk : (hovering ? Color.hover : Color.clear))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(prominent ? Color.clear : Color.rule, lineWidth: 1)
                )
                .opacity(isEnabled ? (configuration.isPressed ? 0.7 : 1) : 0.45)
                .contentShape(Rectangle())
                .onHover { hovering = $0 }
        }
    }
}

/// 只有图标 / 文字、没有边框的轻按钮（标签栏、抽屉标题栏用）
@MainActor
struct QuietButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        QuietBody(configuration: configuration)
    }

    @MainActor
    private struct QuietBody: View {
        let configuration: ButtonStyleConfiguration
        @State private var hovering = false

        var body: some View {
            configuration.label
                .foregroundStyle(hovering ? Color.ink : Color.ink3)
                .padding(.horizontal, 6)
                .frame(minWidth: 24, minHeight: 24)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(hovering ? Color.hover : .clear))
                .opacity(configuration.isPressed ? 0.6 : 1)
                .contentShape(Rectangle())
                .onHover { hovering = $0 }
        }
    }
}

/// 抽屉里的工具标签（chip）
@MainActor
struct ChipStyle: ButtonStyle {
    var selected: Bool

    func makeBody(configuration: Configuration) -> some View {
        ChipBody(configuration: configuration, selected: selected)
    }

    @MainActor
    private struct ChipBody: View {
        let configuration: ButtonStyleConfiguration
        let selected: Bool
        @State private var hovering = false

        var body: some View {
            configuration.label
                .font(.system(size: 12.5))
                .lineLimit(1)
                .foregroundStyle(selected ? Color.white : Color.ink2)
                .padding(.horizontal, 12)
                .frame(height: 30)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(selected ? Color.accentInk : (hovering ? Color.hover : .clear))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(selected ? Color.accentInk : Color.rule, lineWidth: 1)
                )
                .opacity(configuration.isPressed ? 0.75 : 1)
                .contentShape(Rectangle())
                .onHover { hovering = $0 }
        }
    }
}

/// 纸面输入框外观
struct PaperFieldModifier: ViewModifier {
    var mono = true

    func body(content: Content) -> some View {
        content
            .textFieldStyle(.plain)
            .font(mono ? PaperFont.mono(12.5) : .system(size: 13))
            .foregroundStyle(Color.ink)
            .padding(.horizontal, 10)
            .frame(minHeight: 32)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.paper))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.rule, lineWidth: 1))
    }
}

extension View {
    func paperField(mono: Bool = true) -> some View {
        modifier(PaperFieldModifier(mono: mono))
    }
}

/// 分段选择（选项 ≤ 4 个时用）：选中项强调色下划线
@MainActor
struct PaperSegmented: View {
    let choices: [ToolChoice]
    @Binding var selection: String

    var body: some View {
        HStack(spacing: 2) {
            ForEach(choices, id: \.value) { choice in
                let selected = choice.value == selection
                Button {
                    selection = choice.value
                } label: {
                    Text(choice.label.text)
                        .font(.system(size: 12.5, weight: selected ? .semibold : .regular))
                        .foregroundStyle(selected ? Color.ink : Color.ink3)
                        .padding(.horizontal, 9)
                        .frame(height: 28)
                        .background(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(selected ? Color.paper : .clear)
                        )
                        .overlay(alignment: .bottom) {
                            if selected {
                                Capsule().fill(Color.accentInk).frame(height: 2).padding(.horizontal, 8)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.well))
        .fixedSize()
    }
}

/// 纸面风格的勾选框
@MainActor
struct PaperCheckbox: View {
    let label: String
    @Binding var isOn: Bool

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(spacing: 7) {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(isOn ? Color.accentInk : Color.paper)
                    .overlay(
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .strokeBorder(isOn ? Color.accentInk : Color.rule, lineWidth: 1)
                    )
                    .overlay {
                        if isOn {
                            Image(systemName: "checkmark")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.white)
                        }
                    }
                    .frame(width: 15, height: 15)
                Text(label)
                    .font(.system(size: 12.5))
                    .foregroundStyle(Color.ink2)
            }
            .frame(height: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// 下拉菜单（选项多于 4 个时用）
@MainActor
struct PaperMenu: View {
    let choices: [ToolChoice]
    @Binding var selection: String

    var body: some View {
        Menu {
            ForEach(choices, id: \.value) { choice in
                Button {
                    selection = choice.value
                } label: {
                    if choice.value == selection {
                        Label(choice.label.text, systemImage: "checkmark")
                    } else {
                        Text(choice.label.text)
                    }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(choices.first(where: { $0.value == selection })?.label.text ?? selection)
                    .font(.system(size: 12.5))
                    .foregroundStyle(Color.ink)
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Color.ink3)
            }
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.paper))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Color.rule, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
    }
}

/// 字段标题（11pt 墨灰）
@MainActor
struct FieldLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(Color.ink3)
            .lineLimit(1)
    }
}
