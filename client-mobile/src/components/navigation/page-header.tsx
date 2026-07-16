import { ArrowLeft } from "lucide-react-native"
import type { ReactNode } from "react"
import { Platform, Pressable } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  Button,
  type GetProps,
  H5,
  Separator,
  SizableText,
  XStack,
  YStack,
} from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"

type HeaderButtonProps = {
  accessibilityLabel: string
  children?: ReactNode
  circular?: boolean
  icon?: GetProps<typeof Button>["icon"]
  onPress: () => void
  subtlePress: boolean
}

function HeaderButton({
  accessibilityLabel,
  children,
  circular = false,
  icon,
  onPress,
  subtlePress,
}: HeaderButtonProps) {
  const button = (pressed = false) => (
    <Button
      accessible={Platform.OS === "web"}
      aria-label={accessibilityLabel}
      chromeless
      circular={circular}
      forceStyle={pressed ? "press" : undefined}
      icon={icon}
      onPress={Platform.OS === "web" ? onPress : undefined}
      pointerEvents={Platform.OS === "web" ? "auto" : "none"}
      pressStyle={subtlePress ? { background: "$color1" } : undefined}
      size="$4"
    >
      {children}
    </Button>
  )

  if (Platform.OS === "web") {
    return button()
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      pressRetentionOffset={0}
    >
      {({ pressed }) => button(pressed)}
    </Pressable>
  )
}

export function PageHeader({
  actionIcon,
  actionLabel,
  compactTitle = false,
  onActionPress,
  onBackPress,
  subtleButtonPress = false,
  title,
  titleLeading,
}: {
  actionIcon?: GetProps<typeof Button>["icon"]
  actionLabel?: string
  compactTitle?: boolean
  onActionPress?: () => void
  onBackPress: () => void
  subtleButtonPress?: boolean
  title: string
  titleLeading?: ReactNode
}) {
  const insets = useSafeAreaInsets()

  return (
    <YStack bg="$background" pt={insets.top}>
      <XStack height={56} items="center" px="$2">
        <XStack width={72}>
          <HeaderButton
            accessibilityLabel="返回"
            circular
            icon={<ThemedIcon icon={ArrowLeft} size={22} />}
            onPress={onBackPress}
            subtlePress={subtleButtonPress}
          />
        </XStack>

        <XStack flex={1} gap="$2" items="center" justify="center" minW={0}>
          {titleLeading}
          {compactTitle ? (
            <SizableText flex={1} numberOfLines={1} size="$4" text="center">
              {title}
            </SizableText>
          ) : (
            <H5 flex={1} numberOfLines={1} text="center">
              {title}
            </H5>
          )}
        </XStack>

        <XStack justify="flex-end" width={72}>
          {actionLabel && onActionPress ? (
            <HeaderButton
              accessibilityLabel={actionLabel}
              circular={Boolean(actionIcon)}
              icon={actionIcon}
              onPress={onActionPress}
              subtlePress={subtleButtonPress}
            >
              {actionIcon ? null : actionLabel}
            </HeaderButton>
          ) : null}
        </XStack>
      </XStack>
      <Separator />
    </YStack>
  )
}
