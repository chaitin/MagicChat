import { Menu, type LucideIcon } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { SizableText, XStack, YStack } from "tamagui"

import { CompactIconButton } from "@/components/buttons/compact-icon-button"

export type HeaderAction = {
  icon: LucideIcon
  label: string
  onPress: () => void
}

export function AppHeader({
  actions = [],
  onMenuPress,
  title,
}: {
  actions?: HeaderAction[]
  onMenuPress: () => void
  title: string
}) {
  const insets = useSafeAreaInsets()

  return (
    <YStack bg="$background" pt={insets.top}>
      <XStack height={56} items="center" px="$3">
        <XStack width={72}>
          <CompactIconButton
            accessibilityLabel="打开菜单"
            icon={Menu}
            iconSize={26}
            onPress={onMenuPress}
            strokeWidth={1.5}
          />
        </XStack>

        <SizableText flex={1} numberOfLines={1} size="$4" text="center">
          {title}
        </SizableText>

        <XStack gap="$1" justify="flex-end" width={72}>
          {actions.slice(0, 2).map((action) => (
            <CompactIconButton
              accessibilityLabel={action.label}
              icon={action.icon}
              iconSize={26}
              key={action.label}
              onPress={action.onPress}
              strokeWidth={1.5}
            />
          ))}
        </XStack>
      </XStack>
    </YStack>
  )
}
