import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSubmitEditingEventData,
} from "react-native"
import Svg, { Path } from "react-native-svg"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

type XGUIFilledSearchBarBaseProps = {
  accessibilityLabel?: string
  placeholder?: string
}

type XGUIFilledSearchBarButtonProps = XGUIFilledSearchBarBaseProps & {
  onChangeText?: never
  onPress: () => void
  value?: never
}

type XGUIFilledSearchBarInputProps = XGUIFilledSearchBarBaseProps & {
  autoFocus?: boolean
  onCancel: () => void
  onChangeText: (value: string) => void
  onPress?: never
  onSubmitEditing?: (
    event: NativeSyntheticEvent<TextInputSubmitEditingEventData>
  ) => void
  value: string
}

export type XGUIFilledSearchBarProps =
  | XGUIFilledSearchBarButtonProps
  | XGUIFilledSearchBarInputProps

function isInputProps(
  props: XGUIFilledSearchBarProps
): props is XGUIFilledSearchBarInputProps {
  return typeof props.onChangeText === "function"
}

export function XGUIFilledSearchBar(props: XGUIFilledSearchBarProps) {
  const { colors } = useXGUITheme()
  const placeholder = props.placeholder ?? "搜索"

  if (isInputProps(props)) {
    return (
      <View
        style={[
          styles.searchBar,
          styles.editableSearchBar,
          { backgroundColor: colors.background0 },
        ]}
      >
        <View style={[styles.form, styles.editableForm, { backgroundColor: colors.background2 }]}>
          <WeUISearchIcon color={colors.textPlaceholder} />
          <TextInput
            accessibilityLabel={props.accessibilityLabel ?? placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={props.autoFocus}
            cursorColor={colors.brand}
            onChangeText={props.onChangeText}
            onSubmitEditing={props.onSubmitEditing}
            placeholder={placeholder}
            placeholderTextColor={colors.textPlaceholder}
            returnKeyType="search"
            selectionColor={colors.brand}
            style={[styles.input, { color: colors.textPrimary }]}
            value={props.value}
          />
          {props.value ? (
            <Pressable
              accessibilityLabel="清除搜索内容"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => props.onChangeText("")}
              style={styles.clearButton}
            >
              <WeUIClearIcon color={colors.textPlaceholder} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="取消搜索"
          accessibilityRole="button"
          hitSlop={6}
          onPress={props.onCancel}
        >
          <Text style={[styles.cancel, { color: colors.textPrimary }]}>取消</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={[styles.searchBar, { backgroundColor: colors.background0 }]}>
      <Pressable
        accessibilityLabel={props.accessibilityLabel ?? placeholder}
        accessibilityRole="button"
        onPress={props.onPress}
        style={({ pressed }) => [
          styles.form,
          {
            backgroundColor: pressed
              ? colors.background1
              : colors.background2,
          },
        ]}
      >
        <WeUISearchIcon color={colors.textPlaceholder} />
        <Text style={[styles.label, { color: colors.textPlaceholder }]}>
          {placeholder}
        </Text>
      </Pressable>
    </View>
  )
}

function WeUISearchIcon({ color }: { color: string }) {
  return (
    <Svg height={24} viewBox="0 0 24 24" width={24}>
      <Path
        d="M16.31 15.561l4.114 4.115-.848.848-4.123-4.123a7 7 0 1 1 .857-.84zM16.8 11a5.8 5.8 0 1 0-11.6 0 5.8 5.8 0 0 0 11.6 0z"
        fill={color}
        fillRule="evenodd"
      />
    </Svg>
  )
}

function WeUIClearIcon({ color }: { color: string }) {
  return (
    <Svg height={18} viewBox="0 0 24 24" width={18}>
      <Path
        d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm3.54 5.75L12 11.29 8.46 7.75l-.71.71L11.29 12l-3.54 3.54.71.71L12 12.71l3.54 3.54.71-.71L12.71 12l3.54-3.54-.71-.71z"
        fill={color}
      />
    </Svg>
  )
}

const styles = StyleSheet.create({
  cancel: {
    fontSize: 17,
    lineHeight: 24,
  },
  clearButton: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    width: 30,
  },
  editableForm: {
    flex: 1,
    justifyContent: "flex-start",
    paddingLeft: 8,
  },
  editableSearchBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  form: {
    alignItems: "center",
    borderRadius: 6,
    flexDirection: "row",
    height: 36,
    justifyContent: "center",
    minWidth: 0,
  },
  input: {
    flex: 1,
    fontSize: 17,
    height: 36,
    includeFontPadding: false,
    paddingHorizontal: 4,
    paddingVertical: 0,
  },
  label: {
    fontSize: 17,
    lineHeight: 24,
    marginLeft: 4,
  },
  searchBar: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
})
