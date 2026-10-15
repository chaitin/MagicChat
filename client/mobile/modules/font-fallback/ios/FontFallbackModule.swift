import CoreText
import ExpoModulesCore
import UIKit
import ObjectiveC.runtime

public final class FontFallbackModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MagicChatFontFallback")

    Function("registerSystem") { (familyName: String, emojiUri: String, weight: Int) -> Bool in
      guard familyName == "SystemEmojiFallback-\(weight)",
        (100...900).contains(weight), weight % 100 == 0,
        let emojiURL = URL(string: emojiUri), emojiURL.isFileURL,
        let emojiName = registeredFontName(emojiURL) else {
        return false
      }
      return InputFontCascade.register(familyName, weight: weight, emoji: emojiName)
    }
  }
}

private func registeredFontName(_ url: URL) -> String? {
  guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor],
    let descriptor = descriptors.first,
    let name = CTFontDescriptorCopyAttribute(descriptor, kCTFontNameAttribute) as? String else {
    return nil
  }
  var error: Unmanaged<CFError>?
  if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
    guard let registrationError = error?.takeRetainedValue(),
      CFErrorGetCode(registrationError) == Int(CTFontManagerError.alreadyRegistered.rawValue) else {
      return nil
    }
  }
  return name
}

private enum InputFontCascade {
  private static let lock = NSRecursiveLock()
  private static var aliases: [String: (weight: Int, emoji: String)] = [:]
  private static var installed = false

  static func register(_ alias: String, weight: Int, emoji: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard UIFont(name: emoji, size: 16) != nil else { return false }
    if !installed {
      guard let names = class_getClassMethod(UIFont.self, NSSelectorFromString("fontNamesForFamilyName:")),
        let customNames = class_getClassMethod(UIFont.self, #selector(UIFont.jiying_fontNames(forFamilyName:))),
        let font = class_getClassMethod(UIFont.self, NSSelectorFromString("fontWithName:size:")),
        let customFont = class_getClassMethod(UIFont.self, #selector(UIFont.jiying_font(withName:size:))) else {
        return false
      }
      // RN resolves fonts through these two UIFont entry points. Intercept only
      // our explicit aliases, forwarding every other call (including expo-font).
      method_exchangeImplementations(names, customNames)
      method_exchangeImplementations(font, customFont)
      installed = true
    }
    aliases[alias] = (weight, emoji)
    return true
  }

  static func definition(_ alias: String) -> (weight: Int, emoji: String)? {
    lock.lock()
    defer { lock.unlock() }
    return aliases[alias]
  }
}

private extension UIFont {
  @objc static dynamic func jiying_fontNames(forFamilyName family: String) -> [String] {
    if InputFontCascade.definition(family) != nil { return [family] }
    return jiying_fontNames(forFamilyName: family)
  }

  @objc static dynamic func jiying_font(withName name: String, size: CGFloat) -> UIFont? {
    guard let definition = InputFontCascade.definition(name) else {
      return jiying_font(withName: name, size: size)
    }
    let weights: [Int: UIFont.Weight] = [
      100: .ultraLight, 200: .thin, 300: .light, 400: .regular, 500: .medium,
      600: .semibold, 700: .bold, 800: .heavy, 900: .black,
    ]
    let primary = UIFont.systemFont(ofSize: size, weight: weights[definition.weight] ?? .regular)
    let emojiDescriptor = CTFontDescriptorCreateWithNameAndSize(definition.emoji as CFString, size)
    // Preserve the system's language fallback (including CJK), after our emoji font.
    let systemCascade = CTFontCopyDefaultCascadeListForLanguages(primary as CTFont, nil) as? [CTFontDescriptor] ?? []
    let descriptor = CTFontDescriptorCreateCopyWithAttributes(
      CTFontCopyFontDescriptor(primary as CTFont),
      [kCTFontCascadeListAttribute: [emojiDescriptor] + systemCascade] as CFDictionary
    )
    return CTFontCreateWithFontDescriptor(descriptor, size, nil) as UIFont
  }
}
