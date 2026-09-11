import type { ReactNode } from "react"
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import Svg, { Path } from "react-native-svg"

import type { XGUIColors } from "@/xgui/theme/colors"
import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIInformationBarVariant =
  | "tips-strong"
  | "tips-weak"
  | "warn-no-color"
  | "warn-strong"
  | "warn-weak"

export type XGUIInformationBarProps = {
  actionAccessibilityLabel?: string
  actionIcon?: (color: string) => ReactNode
  actionLabel?: string
  floating?: boolean
  message: string
  onActionPress?: () => void
  onClose?: () => void
  showIcon?: boolean
  style?: StyleProp<ViewStyle>
  variant?: XGUIInformationBarVariant
}

export function XGUIInformationBar({
  actionAccessibilityLabel,
  actionIcon,
  actionLabel,
  floating = true,
  message,
  onActionPress,
  onClose,
  showIcon = true,
  style,
  variant = "warn-strong",
}: XGUIInformationBarProps) {
  const { colors } = useXGUITheme()
  const variantColors = resolveInformationBarColors(variant, colors)
  const hasAction = Boolean((actionIcon || actionLabel) && onActionPress)
  const hasFooter = hasAction || Boolean(onClose)

  return (
    <View
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      style={[
        styles.bar,
        floating && styles.floating,
        { backgroundColor: variantColors.background },
        style,
      ]}
    >
      {showIcon ? (
        <View style={styles.header}>
          <WeUIOutlinedWarnIcon color={variantColors.icon} />
        </View>
      ) : null}
      <Text
        style={[
          styles.message,
          !showIcon && !hasFooter && styles.centeredMessage,
          { color: variantColors.foreground },
        ]}
      >
        {message}
      </Text>
      {hasFooter ? (
        <View style={styles.footer}>
          {hasAction ? (
            <Pressable
              accessibilityLabel={actionAccessibilityLabel}
              accessibilityRole={actionIcon ? "button" : "link"}
              onPress={onActionPress}
              style={({ pressed }) => [
                styles.action,
                { opacity: pressed ? 0.5 : 1 },
              ]}
            >
              {actionIcon ? (
                actionIcon(variantColors.link)
              ) : (
                <Text
                  style={[
                    styles.actionText,
                    { color: variantColors.link },
                  ]}
                >
                  {actionLabel}
                </Text>
              )}
            </Pressable>
          ) : null}
          {onClose ? (
            <Pressable
              accessibilityLabel="关闭"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={styles.closeButton}
            >
              {({ pressed }) => (
                <View style={{ opacity: pressed ? 0.5 : 1 }}>
                  <WeUICloseThinIcon color={variantColors.foreground} />
                </View>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function resolveInformationBarColors(
  variant: XGUIInformationBarVariant,
  colors: XGUIColors
) {
  switch (variant) {
    case "warn-weak":
      return {
        background: colors.informationBarWarnWeakBackground,
        foreground: colors.textSecondary,
        icon: colors.destructive,
        link: colors.link,
      }
    case "warn-no-color":
      return {
        background: colors.textPlaceholder,
        foreground: "#FFFFFF",
        icon: "#FFFFFF",
        link: "#FFFFFF",
      }
    case "tips-strong":
      return {
        background: colors.informationBarTipsStrongBackground,
        foreground: "#FFFFFF",
        icon: "#FFFFFF",
        link: "#FFFFFF",
      }
    case "tips-weak":
      return {
        background: colors.background1,
        foreground: colors.textSecondary,
        icon: colors.textSecondary,
        link: colors.link,
      }
    case "warn-strong":
      return {
        background: colors.destructive,
        foreground: "#FFFFFF",
        icon: "#FFFFFF",
        link: "#FFFFFF",
      }
  }
}

function WeUIOutlinedWarnIcon({ color }: { color: string }) {
  return (
    <Svg height={24} viewBox="0 0 24 24" width={24}>
      <Path
        d="M2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12ZM20.8 12C20.8 16.8601 16.8601 20.8 12 20.8C7.13989 20.8 3.2 16.8601 3.2 12C3.2 7.13989 7.13989 3.2 12 3.2C16.8601 3.2 20.8 7.13989 20.8 12ZM12.6592 6.43115L12.5713 13.4917H11.4287L11.3408 6.43115H12.6592ZM11.165 16.2383C11.165 16.707 11.5312 17.0732 12 17.0732C12.4761 17.0732 12.835 16.707 12.835 16.2383C12.835 15.7622 12.4761 15.4033 12 15.4033C11.5312 15.4033 11.165 15.7622 11.165 16.2383Z"
        fill={color}
        fillRule="evenodd"
      />
    </Svg>
  )
}

function WeUICloseThinIcon({ color }: { color: string }) {
  return (
    <Svg height={24} viewBox="0 0 24 24" width={24}>
      <Path
        d="M12.25 10.693L6.057 4.5 5 5.557l6.193 6.193L5 17.943 6.057 19l6.193-6.193L18.443 19l1.057-1.057-6.193-6.193L19.5 5.557 18.443 4.5z"
        fill={color}
        fillRule="evenodd"
      />
    </Svg>
  )
}

const styles = StyleSheet.create({
  action: {
    justifyContent: "center",
    minHeight: 24,
  },
  actionText: {
    fontSize: 14,
    lineHeight: 20,
  },
  bar: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  centeredMessage: {
    textAlign: "center",
  },
  closeButton: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    marginLeft: 8,
    width: 24,
  },
  footer: {
    alignItems: "center",
    flexDirection: "row",
  },
  floating: {
    left: 8,
    position: "absolute",
    right: 8,
    top: 8,
    zIndex: 5500,
  },
  header: {
    marginRight: 8,
  },
  message: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    minWidth: 0,
  },
})
