// eslint-disable-next-line import/no-unresolved
import IconChevronRight from "@tabler/icons-react-native/IconChevronRight"
import { useRouter } from "expo-router"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { useServers } from "@/providers/server-provider"
import { useXGUITheme } from "@/xgui"

export function SelectedServerButton({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter()
  const { selectedServer } = useServers()
  const { colors } = useXGUITheme()

  return (
    <Pressable
      accessibilityLabel={`当前服务器：${selectedServer.name}`}
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => router.push("/server-management")}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed ? colors.background3 : colors.background1,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      testID="login-server"
    >
      <View style={styles.content}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>服务器</Text>
        <Text
          numberOfLines={1}
          style={[styles.value, { color: colors.textPrimary }]}
        >
          {selectedServer.name}
        </Text>
      </View>
      <IconChevronRight color={colors.textSecondary} size={18} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: 16,
    width: "100%",
  },
  content: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
  },
  label: {
    fontSize: 17,
    lineHeight: 24,
    paddingRight: 16,
    width: 105,
  },
  value: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
  },
})
