import { ArrowLeft, type LucideIcon } from "lucide-react-native"
import type { ReactNode } from "react"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  Button,
  type GetProps,
  H5,
  SizableText,
  XStack,
  YStack,
} from "tamagui"

import { CompactIconButton } from "@/components/buttons/compact-icon-button"
import { ThemedIcon } from "@/components/icons/themed-icon"
import { HeaderButton } from "@/components/navigation/header-button"

export const PAGE_HEADER_HEIGHT = 56

export function PageHeader({
  actionIcon,
  compactActionIcon,
  compactIconButtons = false,
  actionLabel,
  compactTitle = true,
  onActionPress,
  onBackPress,
  subtleButtonPress = true,
  title,
  titleLeading,
}: {
  actionIcon?: GetProps<typeof Button>["icon"]
  actionLabel?: string
  compactActionIcon?: LucideIcon
  compactIconButtons?: boolean
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
      <XStack
        height={PAGE_HEADER_HEIGHT}
        items="center"
        px={compactIconButtons ? "$3" : "$2"}
      >
        <XStack width={72}>
          {compactIconButtons ? (
            <CompactIconButton
              accessibilityLabel="返回"
              icon={ArrowLeft}
              iconSize={26}
              onPress={onBackPress}
              strokeWidth={1.5}
            />
          ) : (
            <HeaderButton
              accessibilityLabel="返回"
              circular
              icon={<ThemedIcon icon={ArrowLeft} size={22} />}
              onPress={onBackPress}
              subtlePress={subtleButtonPress}
            />
          )}
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
            compactIconButtons && compactActionIcon ? (
              <CompactIconButton
                accessibilityLabel={actionLabel}
                icon={compactActionIcon}
                iconSize={26}
                onPress={onActionPress}
                strokeWidth={1.5}
              />
            ) : (
              <HeaderButton
                accessibilityLabel={actionLabel}
                circular={Boolean(actionIcon)}
                icon={actionIcon}
                onPress={onActionPress}
                subtlePress={subtleButtonPress}
              >
                {actionIcon ? null : actionLabel}
              </HeaderButton>
            )
          ) : null}
        </XStack>
      </XStack>
    </YStack>
  )
}
