import { Menu, type LucideIcon } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { SizableText, XStack, YStack } from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"
import { HeaderButton } from "@/components/navigation/header-button"

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
      <XStack height={56} items="center" px="$2">
        <XStack width={72}>
          <HeaderButton
            accessibilityLabel="打开菜单"
            circular
            icon={<ThemedIcon icon={Menu} size={22} />}
            onPress={onMenuPress}
          />
        </XStack>

        <SizableText flex={1} numberOfLines={1} size="$4" text="center">
          {title}
        </SizableText>

        <XStack gap="$1" justify="flex-end" width={72}>
          {actions.slice(0, 2).map((action) => (
            <HeaderButton
              accessibilityLabel={action.label}
              circular
              icon={<ThemedIcon icon={action.icon} size={22} />}
              key={action.label}
              onPress={action.onPress}
            />
          ))}
        </XStack>
      </XStack>
    </YStack>
  )
}
