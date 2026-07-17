import { Check } from "lucide-react-native"
import { useCallback, useRef } from "react"
import { StyleSheet } from "react-native"
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable"
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
} from "react-native-reanimated"
import { Button, ListItem, SizableText, useTheme, YStack } from "tamagui"

import type { ServerConfig } from "@/features/servers/server-model"

export function ServerListItem({
  isSelected,
  onDelete,
  onRequestActions,
  onSelect,
  onSwipeableClose,
  onSwipeableOpen,
  server,
}: {
  isSelected: boolean
  onDelete: () => void
  onRequestActions: () => void
  onSelect: () => void
  onSwipeableClose: (close: () => void) => void
  onSwipeableOpen: (close: () => void) => void
  server: ServerConfig
}) {
  const theme = useTheme()
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
    if (server.isBuiltIn) {
      return
    }

    didLongPressRef.current = true
    closeSwipeable()
    onRequestActions()
  }

  const content = (
    <ListItem
      bg="transparent"
      borderWidth={0}
      iconAfter={
        isSelected ? (
          <Check color={String(theme.color10.val)} size={20} />
        ) : undefined
      }
      onLongPress={server.isBuiltIn ? undefined : handleLongPress}
      onPress={handlePress}
      onPressIn={() => {
        didLongPressRef.current = false
      }}
      pressStyle={{
        background: "transparent",
      }}
      rounded="$0"
      size="$4"
      subTitle={
        <SizableText color="$gray9" numberOfLines={1} size="$2">
          {server.url}
        </SizableText>
      }
      title={
        <SizableText
          color={isSelected ? "$color10" : "$gray12"}
          fontWeight="500"
          numberOfLines={1}
          size="$4"
        >
          {server.name}
        </SizableText>
      }
    />
  )

  if (server.isBuiltIn) {
    return (
      <YStack
        bg="transparent"
        borderColor={isSelected ? "$color10" : "$gray9"}
        borderWidth={1}
        overflow="hidden"
        rounded="$4"
      >
        {content}
      </YStack>
    )
  }

  return (
    <YStack
      bg="transparent"
      borderColor={isSelected ? "$color10" : "$gray9"}
      borderWidth={1}
      overflow="hidden"
      rounded="$4"
    >
      <ReanimatedSwipeable
        friction={2}
        onSwipeableClose={() => onSwipeableClose(closeSwipeable)}
        onSwipeableWillOpen={() => onSwipeableOpen(closeSwipeable)}
        ref={swipeableRef}
        renderRightActions={(
          progress,
          _translation,
          swipeableMethods: SwipeableMethods
        ) => (
          <DeleteSwipeAction
            onDelete={onDelete}
            progress={progress}
            swipeableMethods={swipeableMethods}
          />
        )}
        rightThreshold={40}
      >
        {content}
      </ReanimatedSwipeable>
    </YStack>
  )
}

const DELETE_ACTION_WIDTH = 88

function DeleteSwipeAction({
  onDelete,
  progress,
  swipeableMethods,
}: {
  onDelete: () => void
  progress: SharedValue<number>
  swipeableMethods: SwipeableMethods
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          progress.value,
          [0, 1],
          [DELETE_ACTION_WIDTH, 0],
          Extrapolation.CLAMP
        ),
      },
    ],
  }))

  return (
    <Animated.View style={[styles.deleteAction, animatedStyle]}>
      <Button
        height="100%"
        onPress={() => {
          swipeableMethods.close()
          onDelete()
        }}
        rounded="$0"
        theme="red"
        width="100%"
      >
        删除
      </Button>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  deleteAction: {
    height: "100%",
    width: DELETE_ACTION_WIDTH,
  },
})
