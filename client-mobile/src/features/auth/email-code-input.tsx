import { forwardRef } from "react"
import { Pressable } from "react-native"
import {
  Button,
  type GetProps,
  Spinner,
  type TamaguiElement,
  XStack,
  YStack,
} from "tamagui"

import { AppInput } from "@/components/forms/app-input"

type EmailCodeInputProps = Omit<GetProps<typeof AppInput>, "maxLength"> & {
  actionDisabled: boolean
  actionLabel: string
  actionLoading: boolean
  onActionPress: () => void
}

export const EmailCodeInput = forwardRef<TamaguiElement, EmailCodeInputProps>(
  function EmailCodeInput(
    {
      actionDisabled,
      actionLabel,
      actionLoading,
      disabled,
      onActionPress,
      ...inputProps
    },
    ref
  ) {
    return (
      <XStack position="relative" width="100%">
        <AppInput
          {...inputProps}
          disabled={disabled}
          maxLength={8}
          pr={116}
          ref={ref}
          width="100%"
        />
        <YStack
          b={0}
          justify="center"
          position="absolute"
          r="$1"
          t={0}
          z={1}
        >
          <Pressable
            accessibilityLabel={actionLabel}
            accessibilityRole="button"
            accessibilityState={{ disabled: actionDisabled }}
            disabled={actionDisabled}
            hitSlop={4}
            onPress={onActionPress}
          >
            {({ pressed }) => (
              <Button
                accessible={false}
                chromeless
                color={actionDisabled ? "$gray9" : "$color10"}
                disabled={actionDisabled}
                forceStyle={pressed ? "press" : undefined}
                icon={actionLoading ? <Spinner /> : undefined}
                minW={100}
                pointerEvents="none"
                size="$3"
              >
                {actionLabel}
              </Button>
            )}
          </Pressable>
        </YStack>
      </XStack>
    )
  }
)
