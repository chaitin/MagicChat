import { Platform, Pressable, StyleSheet } from "react-native"
import { type GetProps, ListItem } from "tamagui"

type AppListItemProps = Omit<GetProps<typeof ListItem>, "onPress"> & {
  accessibilityLabel: string
  onPress: () => void
}

export function AppListItem({
  accessibilityLabel,
  onPress,
  pressStyle,
  variant = "outlined",
  ...listItemProps
}: AppListItemProps) {
  const resolvedPressStyle = pressStyle ?? { background: "$backgroundPress" }

  if (Platform.OS === "web") {
    return (
      <ListItem
        {...listItemProps}
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        pressStyle={resolvedPressStyle}
        variant={variant}
      />
    )
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      pressRetentionOffset={0}
      style={styles.pressTarget}
    >
      {({ pressed }) => (
        <ListItem
          {...listItemProps}
          accessible={false}
          forceStyle={pressed ? "press" : undefined}
          pointerEvents="none"
          pressStyle={resolvedPressStyle}
          variant={variant}
        />
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pressTarget: {
    alignSelf: "stretch",
  },
})
