import { ArrowLeft, type LucideIcon } from "lucide-react-native"
import type { ReactNode } from "react"
import { StyleSheet, View, type TextStyle } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Text } from "@/components/mi-sans-text"

import { CompactIconButton } from "@/components/buttons/compact-icon-button"
import { ThemedIcon } from "@/components/icons/themed-icon"
import { HeaderButton } from "@/components/navigation/header-button"
import { XGUIButton, useXGUITheme } from "@/xgui"

export const PAGE_HEADER_HEIGHT = 56

export function PageHeader({
  actionIcon,
  actionDisabled = false,
  primaryAction = false,
  backDisabled = false,
  backIcon = ArrowLeft,
  backIconColor,
  background,
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
  actionIcon?: ReactNode
  actionLabel?: string
  backDisabled?: boolean
  backIcon?: LucideIcon
  backIconColor?: string
  background?: string
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
  titleFontWeight?: TextStyle["fontWeight"]
  titleLeading?: ReactNode
}) {
  const insets = useSafeAreaInsets()
  const { colors } = useXGUITheme()

  return (
    <View style={{ backgroundColor: background ?? colors.background0, paddingTop: insets.top }}>
      <View style={[styles.header, { paddingHorizontal: compactIconButtons ? 13 : 7 }]}>
        <View style={styles.leading}>
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
        </View>

        <View style={styles.titleRow}>
          {titleLeading}
          {compactTitle ? (
            <Text
              numberOfLines={1}
              style={[
                styles.title,
                {
                  color: titleColor ?? colors.textPrimary,
                  fontSize: titleFontSize ?? 15,
                  fontWeight: titleFontWeight,
                  lineHeight: titleFontSize ? 24 : 23,
                },
              ]}
            >
              {title}
            </Text>
          ) : (
            <Text accessibilityRole="header" numberOfLines={1} style={[styles.largeTitle, { color: titleColor ?? colors.textPrimary }]}>
              {title}
            </Text>
          )}
        </View>

        <View style={styles.actions}>
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
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  header: { alignItems: "center", flexDirection: "row", height: PAGE_HEADER_HEIGHT },
  leading: { width: 72 },
  titleRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 7,
    justifyContent: "center",
    minWidth: 0,
  },
  title: { flex: 1, textAlign: "center" },
  largeTitle: { flex: 1, fontSize: 18, fontWeight: "600", lineHeight: 26, textAlign: "center" },
  actions: { flexDirection: "row", justifyContent: "flex-end", width: 72 },
})
