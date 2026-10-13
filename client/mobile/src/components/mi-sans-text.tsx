import { Children, Fragment, cloneElement, createContext, forwardRef, isValidElement, useContext, type ReactNode } from "react"
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextProps,
  type TextInputProps,
  type TextStyle,
} from "react-native"

import { getInputFontFamily } from "@/native/android-emoji-font-fallback"
import { splitEmojiText } from "./emoji-text-runs"

const TextFontContext = createContext<{ weight?: TextStyle["fontWeight"]; family?: string }>({})

function miSansForWeight(weight: TextStyle["fontWeight"]) {
  if (weight === "bold" || (weight !== undefined && Number(weight) >= 600)) return "MiSans-Demibold"
  if (weight !== undefined && Number(weight) >= 500) return "MiSans-Medium"
  return "MiSans-Regular"
}

function normalizedMiSansWeight(weight: TextStyle["fontWeight"]): TextStyle["fontWeight"] {
  return weight === "bold" || (weight !== undefined && Number(weight) >= 600) ? "600" : weight
}

export const Text = forwardRef<NativeText, TextProps>(function Text({ children, style, ...props }, ref) {
  const inherited = useContext(TextFontContext)
  const flattened = StyleSheet.flatten(style)
  const weight = flattened?.fontWeight ?? inherited.weight
  const family = flattened?.fontFamily ?? inherited.family
  return (
    <TextFontContext.Provider value={{ weight, family }}>
      <NativeText
        ref={ref}
        {...props}
        style={[
          { fontFamily: family ?? miSansForWeight(weight) },
          style,
          !family && { fontWeight: normalizedMiSansWeight(weight) },
        ]}
      >
        {renderEmojiChildren(children)}
      </NativeText>
    </TextFontContext.Provider>
  )
})

function renderEmojiChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return splitEmojiText(child).map((run, index) => run.emoji ? (
        <NativeText key={index} style={styles.emoji}>{run.text}</NativeText>
      ) : run.text)
    }
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      return cloneElement(child, undefined, renderEmojiChildren(child.props.children))
    }
    return child
  })
}

const styles = StyleSheet.create({
  emoji: { fontFamily: "JiyingEmoji", fontWeight: "normal", fontStyle: "normal" },
})

export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TextInput(
  { style, ...props },
  ref,
) {
  const flattened = StyleSheet.flatten(style)
  return (
    <NativeTextInput
      ref={ref}
      {...props}
      style={[
        style,
        { fontFamily: flattened?.fontFamily ?? getInputFontFamily(flattened?.fontWeight, miSansForWeight(flattened?.fontWeight)) },
        !flattened?.fontFamily && { fontWeight: normalizedMiSansWeight(flattened?.fontWeight) },
      ]}
    />
  )
})
