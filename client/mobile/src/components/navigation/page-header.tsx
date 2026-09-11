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
import { XGUIButton } from "@/xgui/components/xgui-button"

export const PAGE_HEADER_HEIGHT = 56

export function PageHeader({
  actionIcon,
  actionDisabled = false,
  primaryAction = false,
  backDisabled = false,
  backIcon = ArrowLeft,
  backIconColor,
  background = "$background",
  compactActionIcon,
  compactIconButtons = false,
  actionLabel,
  compactTitle = true,
  onActionPress,
  onBackPress,
  subtleButtonPress = true,
  title,
  titleColor,
  titleFontSize,
  titleFontWeight,
  titleLeading,
}: {
  actionDisabled?: boolean
  actionIcon?: GetProps<typeof Button>["icon"]
  actionLabel?: string
  backDisabled?: boolean
  backIcon?: LucideIcon
  backIconColor?: string
  background?: GetProps<typeof YStack>["bg"]
  compactActionIcon?: LucideIcon
  compactIconButtons?: boolean
  compactTitle?: boolean
  onActionPress?: () => void
  onBackPress?: () => void
  primaryAction?: boolean
  subtleButtonPress?: boolean
  title: string
  titleColor?: string
  titleFontSize?: number
  titleFontWeight?: GetProps<typeof SizableText>["fontWeight"]
  titleLeading?: ReactNode
}) {
  const insets = useSafeAreaInsets()

  return (
    <YStack bg={background} pt={insets.top}>
      <XStack
        height={PAGE_HEADER_HEIGHT}
        items="center"
        px={compactIconButtons ? "$3" : "$2"}
      >
        <XStack width={72}>
          {onBackPress ? (
            compactIconButtons ? (
              <CompactIconButton
                accessibilityLabel="返回"
                disabled={backDisabled}
                icon={backIcon}
                iconColor={backIconColor}
                iconSize={26}
                onPress={onBackPress}
                strokeWidth={1.5}
              />
            ) : (
              <HeaderButton
                accessibilityLabel="返回"
                circular
                disabled={backDisabled}
                icon={<ThemedIcon icon={backIcon} size={22} />}
                onPress={onBackPress}
                subtlePress={subtleButtonPress}
              />
            )
          ) : null}
        </XStack>

        <XStack flex={1} gap="$2" items="center" justify="center" minW={0}>
          {titleLeading}
          {compactTitle ? (
            <SizableText
              flex={1}
              fontSize={titleFontSize}
              fontWeight={titleFontWeight}
              lineHeight={titleFontSize ? 24 : undefined}
              numberOfLines={1}
              size="$4"
              style={titleColor ? { color: titleColor } : undefined}
              text="center"
            >
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
                disabled={actionDisabled}
                icon={compactActionIcon}
                iconSize={26}
                onPress={onActionPress}
                strokeWidth={1.5}
              />
            ) : primaryAction ? (
              <XGUIButton
                accessibilityLabel={actionLabel}
                disabled={actionDisabled}
                onPress={onActionPress}
                size="xmini"
              >
                {actionLabel}
              </XGUIButton>
            ) : (
              <HeaderButton
                accessibilityLabel={actionLabel}
                circular={Boolean(actionIcon)}
                disabled={actionDisabled}
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
