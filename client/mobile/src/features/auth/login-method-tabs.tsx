import type { ReactNode } from "react"
import { Pressable, StyleSheet, View } from "react-native"

import { Text } from "@/components/mi-sans-text"
import { useXGUITheme } from "@/xgui"

export type LoginMethod = "email-code" | "password"

export function resolveLoginMethod({
  emailCodeLoginEnabled,
  passwordLoginEnabled,
  preferredMethod,
}: {
  emailCodeLoginEnabled: boolean
  passwordLoginEnabled: boolean
  preferredMethod: LoginMethod
}): LoginMethod | null {
  if (emailCodeLoginEnabled && passwordLoginEnabled) return preferredMethod
  if (emailCodeLoginEnabled) return "email-code"
  if (passwordLoginEnabled) return "password"
  return null
}

export function LoginMethodTabs({
  activeMethod,
  disabled,
  emailCodeContent,
  emailCodeLoginEnabled,
  onMethodChange,
  passwordContent,
  passwordLoginEnabled,
}: {
  activeMethod: LoginMethod | null
  disabled: boolean
  emailCodeContent: ReactNode
  emailCodeLoginEnabled: boolean
  onMethodChange: (method: LoginMethod) => void
  passwordContent: ReactNode
  passwordLoginEnabled: boolean
}) {
  const { colors } = useXGUITheme()

  if (!activeMethod) {
    return (
      <View style={styles.unavailable}>
        <Text style={{ color: colors.textSecondary, fontSize: 15, lineHeight: 23 }}>
          服务器暂不支持登录
        </Text>
      </View>
    )
  }

  if (!emailCodeLoginEnabled || !passwordLoginEnabled) {
    return activeMethod === "email-code" ? emailCodeContent : passwordContent
  }

  return (
    <View style={styles.container}>
      <View accessibilityRole="tablist" style={[styles.tabList, { backgroundColor: colors.background1 }]}>
        {emailCodeLoginEnabled ? (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ disabled, selected: activeMethod === "email-code" }}
            disabled={disabled}
            onPress={() => onMethodChange("email-code")}
            style={[styles.tab, { backgroundColor: activeMethod === "email-code" ? colors.background2 : "transparent" }]}
          >
            <Text style={[styles.tabText, { color: activeMethod === "email-code" ? colors.brand : colors.textSecondary, fontWeight: activeMethod === "email-code" ? "600" : "500" }]}>
              验证码登录
            </Text>
          </Pressable>
        ) : null}
        {passwordLoginEnabled ? (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ disabled, selected: activeMethod === "password" }}
            disabled={disabled}
            onPress={() => onMethodChange("password")}
            style={[styles.tab, { backgroundColor: activeMethod === "password" ? colors.background2 : "transparent" }]}
          >
            <Text style={[styles.tabText, { color: activeMethod === "password" ? colors.brand : colors.textSecondary, fontWeight: activeMethod === "password" ? "600" : "500" }]}>
              密码登录
            </Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.content}>
        {activeMethod === "email-code" ? emailCodeContent : passwordContent}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  unavailable: { alignItems: "center", paddingVertical: 18 },
  container: { width: "100%" },
  tabList: { borderRadius: 10, flexDirection: "row", gap: 1, height: 44, padding: 2, width: "100%" },
  tab: { alignItems: "center", borderRadius: 9, flex: 1, height: "100%", justifyContent: "center" },
  tabText: { fontSize: 14, lineHeight: 21 },
  content: { paddingTop: 18, width: "100%" },
})
