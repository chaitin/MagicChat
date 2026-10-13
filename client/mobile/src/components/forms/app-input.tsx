import { forwardRef, useState } from "react"
import { StyleSheet, type TextInput as NativeTextInput, type TextInputProps } from "react-native"
import { TextInput } from "@/components/mi-sans-text"

import { useXGUITheme } from "@/xgui"

export const AppInput = forwardRef<NativeTextInput, TextInputProps>(function AppInput(
  { onBlur, onFocus, style, ...props },
  ref
) {
  const { colors } = useXGUITheme()
  const [focused, setFocused] = useState(false)

  return (
    <TextInput
      {...props}
      cursorColor={colors.brand}
      onBlur={(event) => { setFocused(false); onBlur?.(event) }}
      onFocus={(event) => { setFocused(true); onFocus?.(event) }}
      placeholderTextColor={colors.textPlaceholder}
      ref={ref}
      selectionColor={colors.brand}
      style={[
        styles.input,
        { backgroundColor: colors.background2, borderColor: focused ? colors.brand : colors.separator, color: colors.textPrimary },
        style,
      ]}
    />
  )
})

const styles = StyleSheet.create({
  input: { borderRadius: 8, borderWidth: 1, fontSize: 15, height: 44, paddingHorizontal: 13 },
})
