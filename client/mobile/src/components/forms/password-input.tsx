import { Eye, EyeOff } from "lucide-react-native"
import { forwardRef, useEffect, useState } from "react"
import { Pressable, StyleSheet, View, type TextInput, type TextInputProps } from "react-native"

import { AppInput } from "@/components/forms/app-input"
import { useXGUITheme } from "@/xgui"

type PasswordInputProps = Omit<TextInputProps, "secureTextEntry"> & {
  disabled?: boolean
}

export const PasswordInput = forwardRef<TextInput, PasswordInputProps>(
  function PasswordInput({ disabled, style, ...inputProps }, ref) {
    const { colors } = useXGUITheme()
    const [isPasswordVisible, setIsPasswordVisible] = useState(false)
    const hasPassword =
      typeof inputProps.value === "string" && inputProps.value.length > 0
    const isToggleDisabled = Boolean(disabled) || !hasPassword
    const ToggleIcon = isPasswordVisible ? EyeOff : Eye

    useEffect(() => {
      if (!hasPassword) setIsPasswordVisible(false)
    }, [hasPassword])

    return (
      <View style={styles.container}>
        <AppInput
          {...inputProps}
          editable={!disabled && inputProps.editable !== false}
          ref={ref}
          secureTextEntry={!isPasswordVisible}
          style={[styles.input, style]}
        />
        <View style={styles.togglePosition}>
          <Pressable
            accessibilityLabel={isPasswordVisible ? "隐藏密码" : "显示密码"}
            accessibilityRole="button"
            accessibilityState={{ disabled: isToggleDisabled }}
            disabled={isToggleDisabled}
            onPress={() => setIsPasswordVisible((visible) => !visible)}
            style={({ pressed }) => [
              styles.toggle,
              pressed && { backgroundColor: colors.background1 },
            ]}
          >
            <ToggleIcon
              color={isToggleDisabled ? colors.textPlaceholder : colors.brand}
              size={18}
            />
          </Pressable>
        </View>
      </View>
    )
  }
)

const styles = StyleSheet.create({
  container: { width: "100%" },
  input: { paddingRight: 46 },
  togglePosition: { bottom: 0, justifyContent: "center", position: "absolute", right: 1, top: 0 },
  toggle: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
})
