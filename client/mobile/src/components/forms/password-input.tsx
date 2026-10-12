import { Eye, EyeOff } from "lucide-react-native"
import { forwardRef, useEffect, useState } from "react"
import { Pressable, StyleSheet } from "react-native"
import {
  type GetProps,
  type TamaguiElement,
  useTheme,
  XStack,
  YStack,
} from "tamagui"

import { AppInput } from "@/components/forms/app-input"

type PasswordInputProps = Omit<
  GetProps<typeof AppInput>,
  "secureTextEntry"
>

export const PasswordInput = forwardRef<TamaguiElement, PasswordInputProps>(
  function PasswordInput({ disabled, ...inputProps }, ref) {
    const theme = useTheme()
    const [isPasswordVisible, setIsPasswordVisible] = useState(false)
    const hasPassword =
      typeof inputProps.value === "string" && inputProps.value.length > 0
    const isToggleDisabled = Boolean(disabled) || !hasPassword
    const ToggleIcon = isPasswordVisible ? EyeOff : Eye

    useEffect(() => {
      if (!hasPassword) setIsPasswordVisible(false)
    }, [hasPassword])

    return (
      <XStack position="relative" width="100%">
        <AppInput
          {...inputProps}
          disabled={disabled}
          pr="$8"
          ref={ref}
          secureTextEntry={!isPasswordVisible}
          width="100%"
        />
        <YStack
          b={0}
          justify="center"
          position="absolute"
          r="$0.5"
          t={0}
          z={1}
        >
          <Pressable
            accessibilityLabel={isPasswordVisible ? "隐藏密码" : "显示密码"}
            accessibilityRole="button"
            accessibilityState={{ disabled: isToggleDisabled }}
            disabled={isToggleDisabled}
            onPress={() => setIsPasswordVisible((visible) => !visible)}
            style={({ pressed }) => [
              styles.toggle,
              pressed && { backgroundColor: String(theme.backgroundPress.val) },
            ]}
          >
            <ToggleIcon
              color={String((isToggleDisabled ? theme.gray9 : theme.color10).val)}
              size={18}
            />
          </Pressable>
        </YStack>
      </XStack>
    )
  }
)

const styles = StyleSheet.create({
  toggle: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
})
