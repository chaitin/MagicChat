// eslint-disable-next-line import/no-unresolved
import IconCircleXFilled from "@tabler/icons-react-native/IconCircleXFilled"
import type { ForwardedRef, ReactNode } from "react"
import { forwardRef, useRef } from "react"
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIInputProps = Omit<
  TextInputProps,
  "placeholderTextColor" | "selectionColor"
> & {
  containerStyle?: StyleProp<ViewStyle>
  clearable?: boolean
  disabled?: boolean
  label: string
  separator?: boolean
  trailing?: ReactNode
}

export const XGUIInput = forwardRef<TextInput, XGUIInputProps>(
  function XGUIInput(
    {
      clearable = false,
      containerStyle,
      disabled = false,
      editable,
      label,
      onChangeText,
      separator = false,
      style,
      trailing,
      value,
      ...textInputProps
    },
    ref
  ) {
    const { colors } = useXGUITheme()
    const inputRef = useRef<TextInput>(null)
    const showClear =
      clearable &&
      !disabled &&
      editable !== false &&
      typeof value === "string" &&
      value.length > 0

    return (
      <View
        style={[
          styles.cell,
          { backgroundColor: colors.background2 },
          containerStyle,
        ]}
      >
        <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
        <TextInput
          {...textInputProps}
          cursorColor={colors.brand}
          editable={disabled ? false : editable}
          onChangeText={onChangeText}
          placeholderTextColor={colors.textPlaceholder}
          ref={(instance) => {
            inputRef.current = instance
            assignForwardedRef(ref, instance)
          }}
          selectionColor={colors.brand}
          style={[
            styles.input,
            {
              color: disabled ? colors.textSecondary : colors.textPrimary,
            },
            style,
          ]}
          value={value}
        />
        {showClear ? (
          <Pressable
            accessibilityLabel={`清空${label}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              onChangeText?.("")
              inputRef.current?.focus()
            }}
            style={styles.clearButton}
          >
            {({ pressed }) => (
              <IconCircleXFilled
                color={pressed ? colors.textSecondary : colors.textPlaceholder}
                size={18}
              />
            )}
          </Pressable>
        ) : null}
        {trailing}
        {separator ? (
          <View
            pointerEvents="none"
            style={[styles.separator, { backgroundColor: colors.separator }]}
          />
        ) : null}
      </View>
    )
  }
)

function assignForwardedRef(
  ref: ForwardedRef<TextInput>,
  instance: TextInput | null
) {
  if (typeof ref === "function") {
    ref(instance)
  } else if (ref) {
    ref.current = instance
  }
}

const styles = StyleSheet.create({
  clearButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    marginLeft: 8,
    width: 28,
  },
  cell: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: 16,
    position: "relative",
    width: "100%",
  },
  input: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    minHeight: 56,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  label: {
    fontSize: 17,
    lineHeight: 24,
    paddingRight: 12,
    width: 80,
  },
  separator: {
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    left: 16,
    position: "absolute",
    right: 16,
  },
})
