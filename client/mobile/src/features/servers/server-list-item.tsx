import * as Haptics from "expo-haptics"
import { useCallback, useRef } from "react"
import { Platform, Pressable, StyleSheet, Text } from "react-native"
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable"
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated"
import type { ServerConfig } from "@/core/server-model"
import { XGUIListItem, useXGUITheme } from "@/xgui"

export function ServerListItem({
  isRecentlyUsed,
  onDelete,
  onEdit,
  onRequestActions,
  onSelect,
  onSwipeableClose,
  onSwipeableOpen,
  separator,
  server,
}: {
  isRecentlyUsed: boolean
  onDelete: () => void
  onEdit: () => void
  onRequestActions: () => void
  onSelect: () => void
  onSwipeableClose: (close: () => void) => void
  onSwipeableOpen: (close: () => void) => void
  separator: boolean
  server: ServerConfig
}) {
  const swipeableRef = useRef<SwipeableMethods | null>(null)
  const didLongPressRef = useRef(false)
  const closeSwipeable = useCallback(() => {
    swipeableRef.current?.close()
  }, [])

  function handlePress() {
    if (didLongPressRef.current) {
      didLongPressRef.current = false
      return
    }

    onSelect()
  }

  function handleLongPress() {
    if (server.isBuiltIn) return

    didLongPressRef.current = true
    closeSwipeable()
    void performLongPressHaptic()
    onRequestActions()
  }

  const content = (
    <XGUIListItem
      accessibilityLabel={`选择${server.name}`}
      description={server.url}
      onLongPress={server.isBuiltIn ? undefined : handleLongPress}
      onPress={handlePress}
      onPressIn={() => {
        didLongPressRef.current = false
      }}
      radio
      separator={separator}
      title={server.name}
      value={isRecentlyUsed ? "最近使用" : undefined}
    />
  )

  if (server.isBuiltIn) return content

  return (
    <ReanimatedSwipeable
      friction={1}
      onSwipeableClose={() => onSwipeableClose(closeSwipeable)}
      onSwipeableWillOpen={() => onSwipeableOpen(closeSwipeable)}
      overshootRight={false}
      ref={swipeableRef}
      renderRightActions={(
        progress,
        _translation,
        swipeableMethods: SwipeableMethods
      ) => (
        <ServerSwipeActions
          onDelete={onDelete}
          onEdit={onEdit}
          progress={progress}
          swipeableMethods={swipeableMethods}
        />
      )}
      rightThreshold={34}
    >
      {content}
    </ReanimatedSwipeable>
  )
}

const SWIPE_ACTION_WIDTH = 68
const SWIPE_ACTIONS_WIDTH = SWIPE_ACTION_WIDTH * 2

function ServerSwipeActions({
  onDelete,
  onEdit,
  progress,
  swipeableMethods,
}: {
  onDelete: () => void
  onEdit: () => void
  progress: SharedValue<number>
  swipeableMethods: SwipeableMethods
}) {
  const { colors } = useXGUITheme()
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          progress.value,
          [0, 1],
          [SWIPE_ACTIONS_WIDTH, 0],
          Extrapolation.CLAMP
        ),
      },
    ],
  }))

  return (
    <Animated.View style={[styles.swipeActions, animatedStyle]}>
      <SwipeAction
        accessibilityLabel="修改服务器"
        backgroundColor={colors.indigo}
        label="修改"
        onPress={() => {
          swipeableMethods.close()
          onEdit()
        }}
      />
      <SwipeAction
        accessibilityLabel="删除服务器"
        backgroundColor={colors.destructive}
        label="删除"
        onPress={() => {
          swipeableMethods.close()
          onDelete()
        }}
      />
    </Animated.View>
  )
}

function SwipeAction({
  accessibilityLabel,
  backgroundColor,
  label,
  onPress,
}: {
  accessibilityLabel: string
  backgroundColor: string
  label: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.swipeAction, { backgroundColor }]}
    >
      <Text style={styles.swipeActionText}>{label}</Text>
    </Pressable>
  )
}

async function performLongPressHaptic() {
  if (Platform.OS === "web") return

  try {
    if (Platform.OS === "android") {
      await Haptics.performAndroidHapticsAsync(
        Haptics.AndroidHaptics.Long_Press
      )
      return
    }

    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  } catch {
    // Haptics are optional feedback and must not block the action sheet.
  }
}

const styles = StyleSheet.create({
  swipeAction: {
    alignItems: "center",
    height: "100%",
    justifyContent: "center",
    paddingHorizontal: 17,
    paddingVertical: 16,
    width: SWIPE_ACTION_WIDTH,
  },
  swipeActions: {
    flexDirection: "row",
    height: "100%",
    width: SWIPE_ACTIONS_WIDTH,
  },
  swipeActionText: {
    color: "#FFFFFF",
    fontSize: 17,
    lineHeight: 24,
  },
})
