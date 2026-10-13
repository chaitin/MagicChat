import { Camera, Images, Paperclip } from "lucide-react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useEffect, useRef, useState } from "react"
import { Pressable, ScrollView, StyleSheet, View } from "react-native"
import { Text } from "@/components/mi-sans-text"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { addRecentEmoji, emojiItems, emojiLabels, normalizeRecentEmoji } from "@/features/conversation/composer/emoji-catalog"
import { useXGUITheme } from "@/xgui"

export type ComposerAccessoryMode = "attachments" | "emoji" | null

const recentStorageKey = "jiying-mobile:expression-picker:recent"

export function ComposerAccessoryPanel({
  disabled,
  mode,
  onCameraPress,
  onEmojiPress,
  onFilePress,
  onLibraryPress,
}: {
  disabled: boolean
  mode: ComposerAccessoryMode
  onCameraPress: () => void
  onEmojiPress: (emoji: string) => void
  onFilePress: () => void
  onLibraryPress: () => void
}) {
  const insets = useSafeAreaInsets()
  const { colors } = useXGUITheme()
  const [recent, setRecent] = useState<string[]>([])
  const recentRef = useRef<string[]>([])
  const recentLoadRef = useRef<Promise<void>>(Promise.resolve())
  const recentWriteRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    if (mode !== "emoji") return
    let active = true
    recentLoadRef.current = AsyncStorage.getItem(recentStorageKey)
      .then((saved) => {
        if (!saved) return
        const next = normalizeRecentEmoji([
          ...recentRef.current,
          ...normalizeRecentEmoji(JSON.parse(saved) as unknown),
        ])
        recentRef.current = next
        if (active) setRecent(next)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [mode])

  function selectEmoji(value: string) {
    const next = addRecentEmoji(recentRef.current, value)
    recentRef.current = next
    setRecent(next)
    recentWriteRef.current = recentWriteRef.current
      .then(() => recentLoadRef.current)
      .then(() => AsyncStorage.setItem(recentStorageKey, JSON.stringify(recentRef.current)))
      .catch(() => undefined)
    onEmojiPress(value)
  }

  if (!mode) return null

  return (
    <View style={{ backgroundColor: colors.background0, marginBottom: -insets.bottom, paddingBottom: insets.bottom }}>
      {mode === "attachments" ? (
        <View style={styles.attachments}>
          <AccessoryAction
            disabled={disabled}
            icon={Camera}
            label="相机"
            onPress={onCameraPress}
          />
          <AccessoryAction
            disabled={disabled}
            icon={Images}
            label="相册"
            onPress={onLibraryPress}
          />
          <AccessoryAction
            disabled={disabled}
            icon={Paperclip}
            label="附件"
            onPress={onFilePress}
          />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} style={styles.emojiScroll}>
          {recent.length > 0 ? (
            <EmojiSection disabled={disabled} label="最近使用" onSelect={selectEmoji} values={recent} />
          ) : null}
          <EmojiSection
            disabled={disabled}
            label="所有表情"
            onSelect={selectEmoji}
            values={emojiItems.map(([value]) => value)}
          />
        </ScrollView>
      )}
    </View>
  )
}

function EmojiSection({
  disabled,
  label,
  onSelect,
  values,
}: {
  disabled: boolean
  label: string
  onSelect: (value: string) => void
  values: readonly string[]
}) {
  const { colors } = useXGUITheme()
  return (
    <View>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.emojiGrid}>
        {values.map((value) => (
          <Pressable
            accessibilityLabel={emojiLabels.get(value) ?? value}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            disabled={disabled}
            key={value}
            onPress={() => onSelect(value)}
            pressRetentionOffset={0}
            style={({ pressed }) => [
              styles.emojiButton,
              pressed ? { backgroundColor: colors.background2 } : null,
            ]}
          >
            <Text style={styles.emojiText}>{value}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  )
}

function AccessoryAction({
  disabled,
  icon,
  label,
  onPress,
}: {
  disabled: boolean
  icon: typeof Camera
  label: string
  onPress: () => void
}) {
  const { colors } = useXGUITheme()
  const Icon = icon

  return (
    <View style={styles.action}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        pressRetentionOffset={0}
        style={({ pressed }) => [
          styles.accessoryButton,
          { backgroundColor: pressed ? colors.background1 : colors.background2 },
        ]}
      >
        <Icon color={colors.textPrimary} size={28} strokeWidth={1.8} />
      </Pressable>
      <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  attachments: { flexDirection: "row", flexWrap: "wrap", minHeight: 132, paddingHorizontal: 13, paddingVertical: 18 },
  emojiScroll: { maxHeight: 184 },
  emojiGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 13, paddingVertical: 4 },
  sectionTitle: { fontSize: 13, lineHeight: 20, paddingHorizontal: 13, paddingTop: 10 },
  action: { alignItems: "center", gap: 7, width: "25%" },
  actionLabel: { fontSize: 13, lineHeight: 20 },
  accessoryButton: {
    alignItems: "center",
    borderRadius: 10,
    height: 64,
    justifyContent: "center",
    width: 64,
  },
  emojiButton: {
    alignItems: "center",
    borderRadius: 6,
    height: 44,
    justifyContent: "center",
    width: "12.5%",
  },
  emojiText: {
    fontSize: 28,
    includeFontPadding: false,
    lineHeight: 36,
    textAlign: "center",
  },
})
