import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react"
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Sheet } from "tamagui"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIPickerValue = string | number

export type XGUIPickerItem<T extends XGUIPickerValue = XGUIPickerValue> = {
  disabled?: boolean
  icon?: (props: { color: string; size: number; strokeWidth: number }) => ReactNode
  label: string
  value: T
}

export type XGUIPickerColumn<T extends XGUIPickerValue = XGUIPickerValue> =
  readonly XGUIPickerItem<T>[]

export type XGUIPickerProps<T extends XGUIPickerValue = XGUIPickerValue> = {
  cancelLabel?: string
  columns: readonly XGUIPickerColumn<T>[]
  confirmLabel?: string
  onCancel?: () => void
  onChange: (value: readonly T[], selectedItems: readonly XGUIPickerItem<T>[]) => void
  onConfirm: (value: readonly T[], selectedItems: readonly XGUIPickerItem<T>[]) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  title?: string
  value: readonly T[]
}

const ITEM_HEIGHT = 56
const VISIBLE_ITEMS = 5
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS

function enabledIndex<T extends XGUIPickerValue>(
  items: XGUIPickerColumn<T>,
  requestedIndex: number
) {
  if (!items.length) return -1
  const index = Math.max(0, Math.min(requestedIndex, items.length - 1))
  if (!items[index]?.disabled) return index
  for (let distance = 1; distance < items.length; distance += 1) {
    const after = index + distance
    const before = index - distance
    if (after < items.length && !items[after]?.disabled) return after
    if (before >= 0 && !items[before]?.disabled) return before
  }
  return -1
}

function selectionFor<T extends XGUIPickerValue>(
  columns: readonly XGUIPickerColumn<T>[],
  value: readonly T[]
) {
  return columns.map((column, columnIndex) => {
    const requested = column.findIndex((item) => item.value === value[columnIndex])
    return enabledIndex(column, requested < 0 ? 0 : requested)
  })
}

type WheelProps<T extends XGUIPickerValue> = {
  items: XGUIPickerColumn<T>
  onSelect: (index: number) => void
  selectedIndex: number
}

function PickerWheel<T extends XGUIPickerValue>({ items, onSelect, selectedIndex }: WheelProps<T>) {
  const { colors } = useXGUITheme()
  const listRef = useRef<FlatList<XGUIPickerItem<T>>>(null)

  useEffect(() => {
    if (selectedIndex < 0) return
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ animated: false, offset: selectedIndex * ITEM_HEIGHT })
    })
  }, [selectedIndex])

  const settle = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const requested = Math.round(event.nativeEvent.contentOffset.y / ITEM_HEIGHT)
      const index = enabledIndex(items, requested)
      if (index < 0) return
      if (index !== requested) {
        listRef.current?.scrollToOffset({ animated: true, offset: index * ITEM_HEIGHT })
      }
      onSelect(index)
    },
    [items, onSelect]
  )

  return (
    <View style={styles.wheel}>
      <FlatList
        accessibilityRole="adjustable"
        bounces={false}
        contentContainerStyle={styles.wheelContent}
        data={items}
        decelerationRate="fast"
        getItemLayout={(_, index) => ({ index, length: ITEM_HEIGHT, offset: ITEM_HEIGHT * index })}
        keyExtractor={(item, index) => `${String(item.value)}-${index}`}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
        ref={listRef}
        renderItem={({ item, index }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: item.disabled, selected: index === selectedIndex }}
            disabled={item.disabled}
            onPress={() => {
              listRef.current?.scrollToOffset({ animated: true, offset: index * ITEM_HEIGHT })
              onSelect(index)
            }}
            style={styles.item}
          >
            <View style={styles.itemContent}>
              {item.icon
                ? item.icon({
                    color: item.disabled ? colors.textPlaceholder : colors.textPrimary,
                    size: 22,
                    strokeWidth: 1,
                  })
                : null}
              <Text
                numberOfLines={1}
                style={[
                  styles.itemText,
                  { color: item.disabled ? colors.textPlaceholder : colors.textPrimary },
                ]}
              >
                {item.label}
              </Text>
            </View>
          </Pressable>
        )}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
      />
      <View
        pointerEvents="none"
        style={[styles.selection, { borderColor: colors.separator }]}
      />
    </View>
  )
}

export function XGUIPicker<T extends XGUIPickerValue>({
  cancelLabel = "取消",
  columns,
  confirmLabel = "确定",
  onCancel,
  onChange,
  onConfirm,
  onOpenChange,
  open,
  title,
  value,
}: XGUIPickerProps<T>) {
  const { colors } = useXGUITheme()
  const insets = useSafeAreaInsets()
  const closeRequestedRef = useRef(false)
  const pendingCloseActionRef = useRef<(() => void) | null>(null)
  const selection = useMemo(() => selectionFor(columns, value), [columns, value])

  useEffect(() => {
    if (!open) return
    closeRequestedRef.current = false
    pendingCloseActionRef.current = null
  }, [open])

  const selectedItems = useMemo(
    () => columns.flatMap((column, index) => column[selection[index]] ?? []),
    [columns, selection]
  )
  const selectedValues = useMemo(() => selectedItems.map((item) => item.value), [selectedItems])
  const canConfirm = columns.length > 0 && selectedItems.length === columns.length

  const close = (afterClose?: () => void) => {
    if (closeRequestedRef.current) return
    closeRequestedRef.current = true
    pendingCloseActionRef.current = afterClose ?? null
    onOpenChange(false)
  }

  const cancel = () => close(onCancel)

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !closeRequestedRef.current) {
      closeRequestedRef.current = true
      pendingCloseActionRef.current = onCancel ?? null
    }
    onOpenChange(nextOpen)
  }

  const select = (columnIndex: number, itemIndex: number) => {
    const next = selection.map((index, indexOfColumn) =>
      indexOfColumn === columnIndex ? itemIndex : index
    )
    const items = columns.flatMap((column, index) => column[next[index]] ?? [])
    if (items.length === columns.length) onChange(items.map((item) => item.value), items)
  }

  return (
    <Sheet
      dismissOnOverlayPress
      dismissOnSnapToBottom
      modal
      onAnimationComplete={({ open: animationOpen }) => {
        if (animationOpen) return
        const pendingCloseAction = pendingCloseActionRef.current
        pendingCloseActionRef.current = null
        pendingCloseAction?.()
      }}
      onOpenChange={handleOpenChange}
      open={open}
      snapPointsMode="fit"
    >
      <Sheet.Overlay backgroundColor="rgba(0,0,0,0.5)" />
      <Sheet.Frame
        bg={colors.background2}
        borderTopLeftRadius={12}
        borderTopRightRadius={12}
        overflow="hidden"
      >
        <View style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
          <View style={[styles.header, { borderBottomColor: colors.separator }]}>
            <Pressable accessibilityRole="button" onPress={cancel} style={styles.headerButton}>
              <Text style={[styles.headerButtonText, { color: colors.textSecondary }]}>{cancelLabel}</Text>
            </Pressable>
            <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !canConfirm }}
              disabled={!canConfirm}
              onPress={() => {
                close(() => onConfirm(selectedValues, selectedItems))
              }}
              style={styles.headerButton}
            >
              <Text style={[styles.headerButtonText, { color: canConfirm ? colors.brand : colors.textPlaceholder }]}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
          <View style={styles.columns}>
            {columns.map((column, index) => (
              <PickerWheel
                items={column}
                key={index}
                onSelect={(itemIndex) => select(index, itemIndex)}
                selectedIndex={selection[index] ?? -1}
              />
            ))}
          </View>
        </View>
      </Sheet.Frame>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  columns: { flexDirection: "row", height: WHEEL_HEIGHT, overflow: "hidden" },
  header: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", minHeight: 56 },
  headerButton: { alignItems: "center", justifyContent: "center", minHeight: 56, minWidth: 72, paddingHorizontal: 16 },
  headerButtonText: { fontSize: 16, lineHeight: 22 },
  item: { alignItems: "center", height: ITEM_HEIGHT, justifyContent: "center", paddingHorizontal: 8 },
  itemContent: { alignItems: "center", flexDirection: "row", gap: 8 },
  itemText: { fontSize: 17, lineHeight: 24, textAlign: "center" },
  selection: { borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth, height: ITEM_HEIGHT, left: 8, position: "absolute", right: 8, top: ITEM_HEIGHT * 2 },
  title: { flex: 1, fontSize: 17, fontWeight: "600", lineHeight: 24, textAlign: "center" },
  wheel: { flex: 1, height: WHEEL_HEIGHT },
  wheelContent: { paddingVertical: ITEM_HEIGHT * 2 },
})
