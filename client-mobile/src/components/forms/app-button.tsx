import { Platform, Pressable, StyleSheet } from "react-native"
import { Button, type ButtonProps } from "tamagui"

/**
 * Keeps Tamagui's Button visuals while using React Native's native press target.
 *
 * Tamagui 2.4.5's responder-based native press handling can reduce a Button's
 * effective hit target to its text content when it is rendered in a ScrollView.
 * The outer Pressable owns the full rectangular hit target; the inner Button is
 * presentation-only on native.
 */
export function AppButton({
  accessibilityLabel,
  accessibilityState,
  children,
  disabled,
  grow,
  onPress,
  testID,
  width,
  ...buttonProps
}: ButtonProps) {
  if (Platform.OS === "web") {
    return (
      <Button
        {...buttonProps}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        disabled={disabled}
        grow={grow}
        onPress={onPress}
        testID={testID}
        width={width}
      >
        {children}
      </Button>
    )
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{
        ...accessibilityState,
        disabled: Boolean(disabled),
      }}
      disabled={Boolean(disabled)}
      onPress={onPress}
      style={[
        styles.pressTarget,
        width === "100%" ? styles.fullWidth : null,
        grow ? styles.grow : null,
      ]}
      testID={testID}
    >
      {({ pressed }) => (
        <Button
          {...buttonProps}
          accessible={false}
          disabled={disabled}
          forceStyle={pressed ? "press" : undefined}
          pointerEvents="none"
          width="100%"
        >
          {children}
        </Button>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  fullWidth: {
    width: "100%",
  },
  grow: {
    flexBasis: 0,
    flexGrow: 1,
  },
  pressTarget: {
    alignSelf: "stretch",
  },
})
