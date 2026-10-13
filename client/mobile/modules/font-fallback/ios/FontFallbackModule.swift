import CoreText
import ExpoModulesCore
import UIKit
import ObjectiveC.runtime

public final class FontFallbackModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MagicChatFontFallback")

    Function("register") { (familyName: String, primaryUri: String, emojiUri: String) -> Bool in
      guard familyName.hasPrefix("MiSansEmojiFallback-"),
        let primaryURL = URL(string: primaryUri), primaryURL.isFileURL,
        let emojiURL = URL(string: emojiUri), emojiURL.isFileURL,
        let primaryName = registeredFontName(primaryURL),
        let emojiName = registeredFontName(emojiURL) else {
        return false
      }
      return InputFontCascade.register(familyName, primary: primaryName, emoji: emojiName)
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
  private static var aliases: [String: (primary: String, emoji: String)] = [:]
  private static var installed = false

  static func register(_ alias: String, primary: String, emoji: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard UIFont(name: primary, size: 16) != nil,
      UIFont(name: emoji, size: 16) != nil else { return false }
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
    aliases[alias] = (primary, emoji)
    return true
  }

  static func definition(_ alias: String) -> (primary: String, emoji: String)? {
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
    guard let primary = jiying_font(withName: definition.primary, size: size) else { return nil }
    let emojiDescriptor = UIFontDescriptor(name: definition.emoji, size: size)
    let descriptor = primary.fontDescriptor.addingAttributes([.cascadeList: [emojiDescriptor]])
    return UIFont(descriptor: descriptor, size: size)
  }
}
