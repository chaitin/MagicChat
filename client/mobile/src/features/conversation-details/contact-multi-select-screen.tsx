import { Check, ChevronLeft } from "lucide-react-native"
import { useMemo, useState } from "react"
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { PageHeader } from "@/components/navigation/page-header"
import type { ContactUser } from "@/core/models"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import {
  HalfScreenSearchInput,
} from "@/features/conversation/half-screen-selection-controls"
import { ContactDirectoryAvatar } from "@/features/contacts/contact-directory-avatar"
import { buildDirectorySections } from "@/features/contacts/contact-directory-model"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { useClientData } from "@/providers/client-data-provider"
import { useXGUITheme } from "@/xgui"

export function ContactMultiSelectScreen({
  excludedUserIds = [],
  initialSelectedUserIds = [],
  onCancel,
  onComplete,
  submitting,
  title,
}: {
  excludedUserIds?: string[]
  initialSelectedUserIds?: string[]
  onCancel: () => void
  onComplete: (userIds: string[]) => void
  submitting: boolean
  title: string
}) {
  const insets = useSafeAreaInsets()
  const session = useAuthenticatedSession()
  const { contacts, contactsError, isReady } = useClientData()
  const { colors } = useXGUITheme()
  const [keyword, setKeyword] = useState("")
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(initialSelectedUserIds.map(normalizeId))
  )
  const excludedIds = useMemo(
    () =>
      new Set([
        normalizeId(session.userId),
        ...excludedUserIds.map(normalizeId),
      ]),
    [excludedUserIds, session.userId]
  )
  const selectableContacts = useMemo(
    () => ({
      ...contacts,
      users: contacts.users.filter(
        (user) => !excludedIds.has(normalizeId(user.id))
      ),
    }),
    [contacts, excludedIds]
  )
  const visibleUsers = useMemo(
    () =>
      buildDirectorySections({
        activeTab: "user",
        contacts: selectableContacts,
        currentUserId: session.userId,
        keyword,
      }).flatMap((section) =>
        section.data.flatMap((item) =>
          item.type === "user" ? [item.value] : []
        )
      ),
    [keyword, selectableContacts, session.userId]
  )
  const selectedUsers = selectableContacts.users.filter((user) =>
    selectedIds.has(normalizeId(user.id))
  )
  const canComplete = selectedUsers.length > 0 && !submitting

  function toggleUser(userId: string) {
    const normalizedId = normalizeId(userId)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(normalizedId)) next.delete(normalizedId)
      else next.add(normalizedId)
      return next
    })
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background0 }]}>
      <PageHeader
        actionDisabled={!canComplete}
        actionLabel={
          selectedUsers.length > 0 ? `完成(${selectedUsers.length})` : "完成"
        }
        backIcon={ChevronLeft}
        backIconColor={colors.textPrimary}
        background={colors.background0}
        compactIconButtons
        onActionPress={() =>
          onComplete(selectedUsers.map((selectedUser) => selectedUser.id))
        }
        onBackPress={onCancel}
        primaryAction
        subtleButtonPress={false}
        title={title}
        titleColor={colors.textPrimary}
        titleFontSize={17}
        titleFontWeight="600"
      />

      <HalfScreenSearchInput
        onChangeText={setKeyword}
        placeholder="搜索"
        value={keyword}
      />

      <FlatList
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 16 },
        ]}
        data={visibleUsers}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(user) => user.id}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {!isReady
                ? "正在加载联系人…"
                : contactsError
                  ? "联系人加载失败"
                  : keyword.trim()
                    ? "没有找到相关联系人"
                    : "暂无可选择的联系人"}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const selected = selectedIds.has(normalizeId(item.id))
          return (
            <ContactSelectionRow
              onPress={() => toggleUser(item.id)}
              selected={selected}
              user={item}
            />
          )
        }}
      />
    </View>
  )
}

function ContactSelectionRow({
  onPress,
  selected,
  user,
}: {
  onPress: () => void
  selected: boolean
  user: ContactUser
}) {
  const session = useAuthenticatedSession()
  const { colors } = useXGUITheme()
  const displayName = getContactDisplayName(user)

  return (
    <Pressable
      accessibilityLabel={`${selected ? "取消选择" : "选择"}${displayName}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.background1 : colors.background2,
        },
      ]}
    >
      <View
        style={[
          styles.checkbox,
          {
            backgroundColor: selected ? colors.brand : "transparent",
            borderColor: selected ? colors.brand : colors.foreground4,
          },
        ]}
      >
        {selected ? <Check color="#FFFFFF" size={16} strokeWidth={3} /> : null}
      </View>
      <ContactDirectoryAvatar
        avatar={user.avatar}
        name={displayName}
        online={user.online}
        server={session}
        type="user"
      />
      <Text
        numberOfLines={1}
        style={[styles.name, { color: colors.textPrimary }]}
      >
        {displayName}
      </Text>
      <View
        pointerEvents="none"
        style={[styles.separator, { backgroundColor: colors.separator }]}
      />
    </Pressable>
  )
}

function normalizeId(value: string) {
  return value.toLocaleLowerCase()
}

const styles = StyleSheet.create({
  checkbox: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  emptyState: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 64,
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  listContent: {
    flexGrow: 1,
  },
  name: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    height: 56,
    paddingHorizontal: 16,
    position: "relative",
  },
  screen: {
    flex: 1,
  },
  separator: {
    bottom: StyleSheet.hairlineWidth,
    height: StyleSheet.hairlineWidth,
    left: 64,
    position: "absolute",
    right: 16,
  },
})
