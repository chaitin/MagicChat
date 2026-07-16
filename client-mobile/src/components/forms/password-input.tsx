import { Eye, EyeOff } from "lucide-react-native"
import { forwardRef, useState } from "react"
import {
  Button,
  type GetProps,
  type TamaguiElement,
  XStack,
  YStack,
} from "tamagui"

import { AppInput } from "@/components/forms/app-input"
import { ThemedIcon } from "@/components/icons/themed-icon"

type PasswordInputProps = Omit<
  GetProps<typeof AppInput>,
  "secureTextEntry"
>

export const PasswordInput = forwardRef<TamaguiElement, PasswordInputProps>(
  function PasswordInput({ disabled, ...inputProps }, ref) {
    const [isPasswordVisible, setIsPasswordVisible] = useState(false)

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
          <Button
            accessibilityLabel={isPasswordVisible ? "隐藏密码" : "显示密码"}
            chromeless
            circular
            color="$color10"
            disabled={disabled}
            icon={
              <ThemedIcon icon={isPasswordVisible ? EyeOff : Eye} size={18} />
            }
            onPress={() => setIsPasswordVisible((visible) => !visible)}
            size="$3"
          />
        </YStack>
      </XStack>
    )
  }
)
