import { createContext, type ReactNode, useContext } from "react"
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from "react-native"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIListVariant = "default" | "form-radio"
export type XGUIListSize = "default" | "large"

export type XGUIListProps = {
  children: ReactNode
  size?: XGUIListSize
  title?: string
  variant?: XGUIListVariant
}

export type XGUIListItemProps = {
  accessibilityLabel?: string
  centerContent?: boolean
  description?: string
  descriptionFontSize?: number
  descriptionNumberOfLines?: number
  disabled?: boolean
  destructive?: boolean
  icon?: (props: { color: string; size: number; strokeWidth: number }) => ReactNode
  leading?: ReactNode
  link?: boolean
  minHeight?: number
  onLongPress?: () => void
  onPress?: () => void
  onPressIn?: () => void
  radio?: boolean
  separator?: boolean
  title: string
  titleFontSize?: number
  titleNumberOfLines?: number
  trailing?: ReactNode
  value?: string
  valuePlaceholder?: boolean
}

const XGUIListVariantContext = createContext<XGUIListVariant>("default")
const XGUIListSizeContext = createContext<XGUIListSize>("default")

export function XGUIList({
  children,
  size = "default",
  title,
  variant = "default",
}: XGUIListProps) {
  const { colors } = useXGUITheme()
  const formRadio = variant === "form-radio"

  return (
    <View>
      {title ? (
        <Text style={[styles.listTitle, { color: colors.textSecondary }]}>
          {title}
        </Text>
      ) : null}
      <XGUIListVariantContext.Provider value={variant}>
        <XGUIListSizeContext.Provider value={size}>
          <View
            style={[
              styles.list,
              !title && styles.listWithoutTitle,
              formRadio && styles.formRadioList,
              {
                backgroundColor: colors.background2,
              },
            ]}
          >
            {!formRadio ? (
              <View
                pointerEvents="none"
                style={[
                  styles.outerSeparator,
                  styles.topSeparator,
                  { backgroundColor: colors.separator },
                ]}
              />
            ) : null}
            {children}
            {!formRadio ? (
              <View
                pointerEvents="none"
                style={[
                  styles.outerSeparator,
                  styles.bottomSeparator,
                  { backgroundColor: colors.separator },
                ]}
              />
            ) : null}
          </View>
        </XGUIListSizeContext.Provider>
      </XGUIListVariantContext.Provider>
    </View>
  )
}

export function XGUIListItem({
  accessibilityLabel,
  centerContent = false,
  description,
  descriptionFontSize,
  descriptionNumberOfLines = 1,
  disabled = false,
  destructive = false,
  icon,
  leading,
  link = false,
  minHeight,
  onLongPress,
  onPress,
  onPressIn,
  radio = false,
  separator = false,
  title,
  titleFontSize,
  titleNumberOfLines = 1,
  trailing,
  value,
  valuePlaceholder = false,
}: XGUIListItemProps) {
  const { colors } = useXGUITheme()
  const formRadio = useContext(XGUIListVariantContext) === "form-radio"
  const large = useContext(XGUIListSizeContext) === "large"
  const accessibilityRole: ViewProps["accessibilityRole"] = radio
    ? "radio"
    : onPress
      ? "button"
      : undefined

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onLongPress={onLongPress}
      onPress={onPress}
      onPressIn={onPressIn}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.item,
            large && styles.largeItem,
            formRadio && styles.formRadioItem,
            centerContent && styles.centeredItem,
            minHeight ? { minHeight } : null,
            {
              backgroundColor: colors.background2,
            },
          ]}
        >
          {separator ? (
            <View
              pointerEvents="none"
              style={[
                styles.separator,
                formRadio && styles.formItemSeparator,
                { backgroundColor: colors.separator },
              ]}
            />
          ) : null}
          {icon ? (
            <View
              style={[styles.leading, centerContent && styles.centeredLeading]}
            >
              {icon({
                color: destructive ? colors.destructive : colors.textSecondary,
                size: large ? 26 : 24,
                strokeWidth: 1,
              })}
            </View>
          ) : leading ? (
            <View
              style={[styles.leading, centerContent && styles.centeredLeading]}
            >
              {leading}
            </View>
          ) : null}
          <View style={[styles.body, centerContent && styles.centeredBody]}>
            <Text
              numberOfLines={titleNumberOfLines}
              style={[
                styles.itemTitle,
                large && styles.largeItemTitle,
                titleFontSize
                  ? {
                      fontSize: titleFontSize,
                      lineHeight: Math.max(24, titleFontSize + 6),
                    }
                  : null,
                {
                  color: destructive
                    ? colors.destructive
                    : link
                      ? colors.link
                      : colors.textPrimary,
                },
              ]}
            >
              {title}
            </Text>
            {description ? (
              <Text
                numberOfLines={descriptionNumberOfLines}
                style={[
                  styles.description,
                  descriptionFontSize
                    ? {
                        fontSize: descriptionFontSize,
                        lineHeight: Math.max(17, descriptionFontSize + 6),
                      }
                    : null,
                  { color: colors.textPlaceholder },
                ]}
              >
                {description}
              </Text>
            ) : null}
          </View>
          {value ? (
            <Text
              ellipsizeMode="tail"
              numberOfLines={1}
              style={[
                styles.value,
                large && styles.largeValue,
                titleFontSize
                  ? {
                      fontSize: titleFontSize,
                      lineHeight: Math.max(24, titleFontSize + 6),
                    }
                  : null,
                {
                  color: valuePlaceholder
                    ? colors.textPlaceholder
                    : colors.textSecondary,
                },
              ]}
            >
              {value}
            </Text>
          ) : null}
          {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
          {pressed ? (
            <View
              pointerEvents="none"
              style={[styles.activeMask, { backgroundColor: colors.separator }]}
            />
          ) : null}
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  activeMask: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  bottomSeparator: {
    bottom: 0,
  },
  centeredBody: {
    flex: 0,
  },
  centeredItem: {
    justifyContent: "center",
  },
  centeredLeading: {
    marginRight: 8,
  },
  description: {
    fontSize: 12,
    lineHeight: 17,
    paddingTop: 4,
  },
  formItemSeparator: {
    left: 16,
    right: 16,
  },
  formRadioItem: {
    paddingHorizontal: 16,
  },
  formRadioList: {
    borderRadius: 8,
  },
  item: {
    alignItems: "center",
    flexDirection: "row",
    padding: 16,
    position: "relative",
  },
  itemTitle: {
    fontSize: 17,
    lineHeight: 24,
  },
  largeItem: {
    minHeight: 60,
  },
  largeItemTitle: {
    fontSize: 18,
  },
  largeValue: {
    fontSize: 18,
  },
  leading: {
    marginRight: 16,
  },
  list: {
    overflow: "hidden",
    position: "relative",
  },
  listTitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 3,
    marginTop: 16,
    paddingHorizontal: 16,
  },
  listWithoutTitle: {
    marginTop: 8,
  },
  outerSeparator: {
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    left: 16,
    position: "absolute",
    right: 0,
    top: 0,
  },
  topSeparator: {
    top: 0,
  },
  trailing: {
    marginLeft: 16,
  },
  value: {
    flexShrink: 1,
    fontSize: 17,
    lineHeight: 24,
    marginLeft: 16,
    maxWidth: "60%",
  },
})
