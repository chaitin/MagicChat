import { createContext, forwardRef, useContext } from "react"
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextProps,
  type TextInputProps,
  type TextStyle,
} from "react-native"

const TextFontContext = createContext<{ weight?: TextStyle["fontWeight"]; family?: string }>({})

function miSansForWeight(weight: TextStyle["fontWeight"]) {
  if (weight === "bold" || (weight !== undefined && Number(weight) >= 600)) return "MiSans-Demibold"
  if (weight !== undefined && Number(weight) >= 500) return "MiSans-Medium"
  return "MiSans-Regular"
}

function normalizedMiSansWeight(weight: TextStyle["fontWeight"]): TextStyle["fontWeight"] {
  return weight === "bold" || (weight !== undefined && Number(weight) >= 600) ? "600" : weight
}

export const Text = forwardRef<NativeText, TextProps>(function Text({ style, ...props }, ref) {
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
      />
    </TextFontContext.Provider>
  )
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
        { fontFamily: flattened?.fontFamily ?? miSansForWeight(flattened?.fontWeight) },
        style,
        !flattened?.fontFamily && { fontWeight: normalizedMiSansWeight(flattened?.fontWeight) },
      ]}
    />
  )
})
