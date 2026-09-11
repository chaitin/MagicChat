import { useLocalSearchParams, useRouter } from "expo-router"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { AppHeader } from "@/components/navigation/app-header"
import { useXGUITheme } from "@/xgui"

export function QrResultScreen() {
  const router = useRouter()
  const { content } = useLocalSearchParams<{ content?: string }>()
  const { colors } = useXGUITheme()

  return (
    <View style={[styles.screen, { backgroundColor: colors.background0 }]}>
      <AppHeader onBackPress={() => router.back()} title="扫描结果" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.result, { color: colors.textPrimary }]}>
          {typeof content === "string" ? content : "未获取到二维码内容"}
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  result: { fontSize: 16, lineHeight: 24 },
  screen: { flex: 1 },
})
