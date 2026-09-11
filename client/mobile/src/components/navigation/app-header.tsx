import { ChevronLeft, Menu } from "lucide-react-native"
import type { ComponentProps, ReactNode, Ref } from "react"
import { Text, type View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { XStack, YStack } from "tamagui"

import { CompactIconButton } from "@/components/buttons/compact-icon-button"
import { useXGUITheme } from "@/xgui"

export const APP_HEADER_HEIGHT = 44

export type HeaderAction = {
  buttonRef?: Ref<View>
  icon: ComponentProps<typeof CompactIconButton>["icon"]
  iconColor?: string
  label: string
  onPress: () => void
  strokeWidth?: number
}

export function AppHeader({
  actions = [],
  backAccessory,
  onBackPress,
  onMenuPress,
  title,
  titleFontSize,
}: {
  actions?: HeaderAction[]
  backAccessory?: ReactNode
  onBackPress?: () => void
  onMenuPress?: () => void
  title: string
  titleFontSize?: number
}) {
  const insets = useSafeAreaInsets()
  const { colors } = useXGUITheme()

  return (
    <YStack bg={colors.background0} pt={insets.top}>
      <XStack height={APP_HEADER_HEIGHT} items="center" px="$3">
        <XStack gap="$1" items="center" width={72}>
          {onBackPress ? (
            <CompactIconButton
              accessibilityLabel="返回"
              icon={ChevronLeft}
              iconColor={colors.textPrimary}
              iconSize={26}
              onPress={onBackPress}
              strokeWidth={1.5}
            />
          ) : onMenuPress ? (
            <CompactIconButton
              accessibilityLabel="打开菜单"
              icon={Menu}
              iconSize={26}
              onPress={onMenuPress}
              strokeWidth={1.5}
            />
          ) : null}
          {onBackPress ? backAccessory : null}
        </XStack>

        <Text
          numberOfLines={1}
          style={{
            color: colors.textPrimary,
            flex: 1,
            fontSize: titleFontSize ?? 18,
            lineHeight: Math.max(24, (titleFontSize ?? 18) + 4),
            textAlign: "center",
          }}
        >
          {title}
        </Text>

        <XStack gap="$1" justify="flex-end" width={72}>
          {actions.slice(0, 2).map((action) => (
            <CompactIconButton
              accessibilityLabel={action.label}
              buttonRef={action.buttonRef}
              icon={action.icon}
              iconColor={action.iconColor}
              iconSize={26}
              key={action.label}
              onPress={action.onPress}
              strokeWidth={action.strokeWidth ?? 1.5}
            />
          ))}
        </XStack>
      </XStack>
    </YStack>
  )
}
