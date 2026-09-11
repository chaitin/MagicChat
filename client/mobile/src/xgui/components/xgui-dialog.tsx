import type { ReactNode } from "react"
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
} from "react-native"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIDialogActionVariant = "default" | "primary" | "destructive"

export type XGUIDialogAction = {
  accessibilityLabel?: string
  disabled?: boolean
  label: string
  onPress: () => void
  variant?: XGUIDialogActionVariant
}

export type XGUIDialogProps = {
  actions: XGUIDialogAction[]
  children?: ReactNode
  description?: string
  dismissible?: boolean
  onOpenChange?: (open: boolean) => void
  open: boolean
  title: string
}

export function XGUIDialog({
  actions,
  children,
  description,
  dismissible = false,
  onOpenChange,
  open,
  title,
}: XGUIDialogProps) {
  const { colors } = useXGUITheme()

  function requestClose() {
    if (dismissible) onOpenChange?.(false)
  }

  return (
    <Modal
      animationType="fade"
      navigationBarTranslucent
      onRequestClose={requestClose}
      statusBarTranslucent
      transparent
      visible={open}
    >
      <View
        accessibilityViewIsModal
        style={[styles.overlay, { backgroundColor: "rgba(0,0,0,0.6)" }]}
      >
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={requestClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.dialog, { backgroundColor: colors.background2 }]}>
          <View style={styles.content}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>
              {title}
            </Text>
            {description ? (
              <Text
                style={[styles.description, { color: colors.textSecondary }]}
              >
                {description}
              </Text>
            ) : null}
            {children}
          </View>
          <View
            style={[styles.actions, { borderTopColor: colors.separator }]}
          >
            {actions.map((action, index) => (
              <Pressable
                accessibilityLabel={action.accessibilityLabel ?? action.label}
                accessibilityRole={"button" satisfies AccessibilityRole}
                accessibilityState={{ disabled: action.disabled }}
                disabled={action.disabled}
                key={`${action.label}:${index}`}
                onPress={action.onPress}
                style={({ pressed }) => [
                  styles.action,
                  index > 0 && {
                    borderLeftColor: colors.separator,
                    borderLeftWidth: StyleSheet.hairlineWidth,
                  },
                  pressed &&
                    !action.disabled && {
                      backgroundColor: colors.foreground5,
                    },
                ]}
              >
                <Text
                  style={[
                    styles.actionText,
                    {
                      color: resolveActionColor(
                        action.variant ?? "default",
                        colors
                      ),
                      opacity: action.disabled ? 0.3 : 1,
                    },
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  )
}

function resolveActionColor(
  variant: XGUIDialogActionVariant,
  colors: ReturnType<typeof useXGUITheme>["colors"]
) {
  if (variant === "primary") return colors.brand5
  if (variant === "destructive") return colors.destructive
  return colors.textPrimary
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: 12,
  },
  actions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  actionText: {
    fontSize: 17,
    fontWeight: "500",
    lineHeight: 24,
    textAlign: "center",
  },
  content: {
    paddingBottom: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  dialog: {
    borderRadius: 12,
    maxWidth: 320,
    overflow: "hidden",
    width: "84%",
  },
  overlay: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 24,
    textAlign: "center",
  },
})
