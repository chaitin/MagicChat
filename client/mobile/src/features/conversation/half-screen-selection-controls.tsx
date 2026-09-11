// Tabler exposes per-icon runtime entry points without per-icon declarations.
// eslint-disable-next-line import/no-unresolved
import IconCircleXFilled from "@tabler/icons-react-native/IconCircleXFilled"
// eslint-disable-next-line import/no-unresolved
import IconSearch from "@tabler/icons-react-native/IconSearch"
import { Check } from "lucide-react-native"
import type { ReactNode } from "react"
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"

import { useXGUITheme } from "@/xgui"

export function HalfScreenSearchInput({
  autoFocus = false,
  onChangeText,
  placeholder,
  value,
}: {
  autoFocus?: boolean
  onChangeText: (value: string) => void
  placeholder: string
  value: string
}) {
  const { colors } = useXGUITheme()

  return (
    <View
      style={[styles.searchContainer, { backgroundColor: colors.background1 }]}
    >
      <IconSearch color={colors.textPlaceholder} size={22} strokeWidth={1.7} />
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        cursorColor={colors.brand}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textPlaceholder}
        returnKeyType="search"
        selectionColor={colors.brand}
        style={[styles.searchInput, { color: colors.textPrimary }]}
        value={value}
      />
      {value ? (
        <Pressable
          accessibilityLabel="清空搜索内容"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onChangeText("")}
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
    </View>
  )
}

export function HalfScreenSelectionRow({
  accessibilityLabel,
  checkbox = false,
  leading,
  onPress,
  selected,
  title,
  trailing,
  value,
}: {
  accessibilityLabel?: string
  checkbox?: boolean
  leading?: ReactNode
  onPress: () => void
  selected?: boolean
  title: string
  trailing?: ReactNode
  value?: string
}) {
  const { colors } = useXGUITheme()

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole={checkbox ? "checkbox" : "button"}
      accessibilityState={{ selected }}
      onPress={onPress}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.row,
            {
              backgroundColor: pressed
                ? colors.background1
                : colors.background2,
            },
          ]}
        >
          {checkbox ? (
            <View
              style={[
                styles.checkbox,
                selected
                  ? { backgroundColor: colors.brand }
                  : { borderColor: colors.textPlaceholder, borderWidth: 1 },
              ]}
            >
              {selected ? (
                <Check color="#FFFFFF" size={15} strokeWidth={2.4} />
              ) : null}
            </View>
          ) : null}
          {leading ? <View style={styles.leading}>{leading}</View> : null}
          <Text
            numberOfLines={1}
            style={[styles.title, { color: colors.textPrimary }]}
          >
            {title}
          </Text>
          {value ? (
            <Text
              numberOfLines={1}
              style={[styles.value, { color: colors.textSecondary }]}
            >
              {value}
            </Text>
          ) : null}
          {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
          <View
            pointerEvents="none"
            style={[
              styles.separator,
              { backgroundColor: colors.separator },
            ]}
          />
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  checkbox: {
    alignItems: "center",
    borderRadius: 11,
    height: 22,
    justifyContent: "center",
    marginRight: 12,
    width: 22,
  },
  clearButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 36,
  },
  leading: {
    marginRight: 12,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    height: 56,
    paddingHorizontal: 16,
    position: "relative",
  },
  searchContainer: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    height: 44,
    marginBottom: 10,
    marginHorizontal: 16,
    paddingLeft: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    height: 44,
    lineHeight: 22,
    paddingHorizontal: 10,
    paddingVertical: 0,
  },
  separator: {
    bottom: StyleSheet.hairlineWidth,
    height: StyleSheet.hairlineWidth,
    left: 16,
    position: "absolute",
    right: 16,
  },
  title: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  trailing: {
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  value: {
    fontSize: 13,
    lineHeight: 18,
    marginLeft: 10,
    maxWidth: "30%",
  },
})
