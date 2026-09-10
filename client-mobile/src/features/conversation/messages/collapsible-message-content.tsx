import { ChevronDown } from "lucide-react-native"
import { type ReactNode, useId, useState } from "react"
import { Pressable, StyleSheet, View } from "react-native"
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg"
import { SizableText, XStack } from "tamagui"

import {
  type CollapsibleMessageVariant,
  getCollapsibleMessageLayout,
} from "@/features/conversation/messages/collapsible-message-layout"
import { useXGUITheme } from "@/xgui"

const EXPAND_LABEL_HEIGHT = 24
const EXPAND_ACTION_HEIGHT = 32
const EXPAND_ACTION_BOTTOM_OVERLAP = 4
const EXPAND_ACTION_LAYOUT_HEIGHT =
  EXPAND_ACTION_HEIGHT - EXPAND_ACTION_BOTTOM_OVERLAP
const FADE_CONTENT_OVERLAP_HEIGHT = 56
const BUBBLE_HORIZONTAL_PADDING = 12

export function CollapsibleMessageContent({
  children,
  tone,
  variant,
}: {
  children: ReactNode
  tone: "mine" | "other"
  variant: CollapsibleMessageVariant
}) {
  const { colors } = useXGUITheme()
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const { collapsed, viewportHeight } = getCollapsibleMessageLayout({
    contentHeight,
    expanded,
    variant,
  })
  const visibleContentHeight =
    collapsed && viewportHeight !== null
      ? Math.max(0, viewportHeight - EXPAND_ACTION_LAYOUT_HEIGHT)
      : viewportHeight
  const viewportStyle =
    visibleContentHeight === null ? undefined : { height: visibleContentHeight }
  const fadeColor = tone === "mine" ? colors.brand1 : colors.background2
  const actionColor = colors.textPrimary

  return (
    <View
      style={styles.container}
    >
      <View style={[styles.contentViewport, viewportStyle]}>
        <View
          onLayout={(event) => {
            const nextHeight = event.nativeEvent.layout.height
            setContentHeight((current) =>
              current === null || nextHeight > current ? nextHeight : current
            )
          }}
          style={styles.content}
        >
          {children}
        </View>
        {collapsed ? (
          <Svg
            height={FADE_CONTENT_OVERLAP_HEIGHT}
            pointerEvents="none"
            style={styles.fade}
            width="100%"
          >
            <Defs>
              <LinearGradient
                id={gradientId}
                x1="0%"
                x2="0%"
                y1="0%"
                y2="100%"
              >
                <Stop offset="0" stopColor={fadeColor} stopOpacity={0} />
                <Stop offset="100%" stopColor={fadeColor} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            <Rect
              fill={`url(#${gradientId})`}
              height={FADE_CONTENT_OVERLAP_HEIGHT}
              width="100%"
              x={0}
              y={0}
            />
          </Svg>
        ) : null}
        {collapsed ? (
          <View
            pointerEvents="none"
            style={[styles.fadeEdge, { backgroundColor: fadeColor }]}
          />
        ) : null}
      </View>

      {collapsed ? (
        <Pressable
          accessibilityLabel="展开"
          accessibilityRole="button"
          accessibilityState={{ expanded: false }}
          hitSlop={8}
          onPress={() => setExpanded(true)}
          style={[styles.expandAction, { backgroundColor: fadeColor }]}
        >
          <XStack
            height={EXPAND_LABEL_HEIGHT}
            gap="$1"
            items="center"
            justify="center"
            pointerEvents="none"
            width="100%"
          >
            <ChevronDown color={actionColor} size={14} />
            <SizableText
              color={colors.textPrimary}
              lineHeight={18}
              size="$3"
            >
              展开
            </SizableText>
          </XStack>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    maxWidth: "100%",
    minWidth: 0,
    position: "relative",
  },
  content: {
    maxWidth: "100%",
    minWidth: 0,
  },
  contentViewport: {
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
  expandAction: {
    alignItems: "center",
    height: EXPAND_ACTION_HEIGHT,
    justifyContent: "center",
    marginBottom: -EXPAND_ACTION_BOTTOM_OVERLAP,
    marginHorizontal: -BUBBLE_HORIZONTAL_PADDING,
  },
  fade: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
  },
  fadeEdge: {
    bottom: 0,
    height: 1,
    left: 0,
    position: "absolute",
    right: 0,
  },
})
