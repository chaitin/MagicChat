import { useRef } from "react"
import { ChevronRight } from "lucide-react-native"
import { Pressable, ScrollView, StyleSheet, View } from "react-native"

import { Text } from "@/components/mi-sans-text"
import { useXGUITheme } from "@/xgui"
import type { OrganizationDirectoryNode } from "../../../../shared/organization-directory"

export function OrganizationDirectoryBreadcrumbs({
  path,
  onNavigate,
}: {
  path: OrganizationDirectoryNode[]
  onNavigate: (key: string | null) => void
}) {
  const { colors } = useXGUITheme()
  const scroll = useRef<ScrollView>(null)
  const items = path
  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel="组织路径"
      contentContainerStyle={styles.content}
      style={[styles.scroll, { backgroundColor: colors.background2, borderBottomColor: colors.separator }]}
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
    >
      {items.map((item, index) => {
        const current = index === items.length - 1
        return (
          <View key={item.key} style={styles.item}>
            {index > 0 ? <ChevronRight size={14} color={colors.textPlaceholder} /> : null}
            {current ? (
              <Text accessibilityLabel={`当前层级：${item.name}`} style={[styles.label, { color: colors.textSecondary }]}>
                {item.name}{typeof item.memberCount === "number" ? ` (${item.memberCount})` : ""}
              </Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`返回${item.name}`}
                onPress={() => onNavigate(item.key)}
                style={styles.link}
              >
                <Text style={[styles.label, { color: colors.link }]}>{item.name}</Text>
              </Pressable>
            )}
          </View>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { alignItems: "center", paddingHorizontal: 16, minHeight: 44 },
  item: { flexDirection: "row", alignItems: "center", gap: 8 },
  link: { justifyContent: "center", minHeight: 44 },
  label: { fontSize: 14, lineHeight: 22, paddingHorizontal: 4 },
})
