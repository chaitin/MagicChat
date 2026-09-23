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
  if (weight === "bold" || (weight !== undefined && Number(weight) >= 700)) return "MiSans-Bold"
  if (weight !== undefined && Number(weight) >= 500) return "MiSans-Medium"
  return "MiSans-Regular"
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
        style={[{ fontFamily: family ?? miSansForWeight(weight) }, style]}
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
      style={[{ fontFamily: flattened?.fontFamily ?? miSansForWeight(flattened?.fontWeight) }, style]}
    />
  )
})
