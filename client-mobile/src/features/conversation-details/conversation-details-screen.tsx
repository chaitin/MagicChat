import { LogOut, Minus, Plus, Trash2 } from "lucide-react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useMemo, useState } from "react"
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { AppAvatar } from "@/components/avatar/app-avatar"
import { AppHeader } from "@/components/navigation/app-header"
import type {
  ClientConversation,
  ClientConversationMember,
} from "@/core/models"
import { ApiRequestError } from "@/data/api-client"
import {
  useDissolveGroupConversation,
  useLeaveGroupConversation,
  useSetConversationMuted,
  useSetConversationPinned,
} from "@/data/conversations/conversation-hooks"
import {
  useArchiveConversationTopic,
  useConversationTopic,
} from "@/data/conversations/topic-hooks"
import {
  useSetUserBlocked,
  useUserBlockStatus,
} from "@/data/user-blocks/user-block-hooks"
import {
  buildAddGroupMembersHref,
  buildCreateGroupConversationHref,
  buildConversationReportHref,
  buildGroupConversationEditHref,
} from "@/navigation/conversations"
import { buildEntityDetailHref } from "@/navigation/entity-details"
import { TopicArchiveDialog } from "@/features/conversation/topic/topic-archive-dialog"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import {
  hydrateClientConversationUsers,
  useClientData,
} from "@/providers/client-data-provider"
import {
  XGUIActionSheet,
  XGUIButton,
  XGUIDialog,
  XGUIList,
  XGUIListItem,
  XGUISwitch,
  useXGUITheme,
  useXGUIToast,
} from "@/xgui"

const MEMBER_AVATAR_SIZE = 40
const MEMBER_TILE_WIDTH = 56
const MEMBER_MIN_COLUMN_GAP = 12
const MEMBER_MAX_COLUMN_GAP = 24
const MEMBER_ROW_GAP = 12

export function ConversationDetailsScreen() {
  const params = useLocalSearchParams<{
    conversationId?: string | string[]
    parentConversationId?: string | string[]
    topic?: string | string[]
  }>()
  const conversationId = firstParam(params.conversationId)
  const parentConversationId = firstParam(params.parentConversationId)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const session = useAuthenticatedSession()
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const {
    contacts,
    conversations,
    ensureUsers,
    isReady,
    usersById,
  } = useClientData()
  const listedConversation = conversations.find(
    (conversation) => conversation.id === conversationId
  )
  const expectsTopic =
    firstParam(params.topic) === "1" ||
    Boolean(parentConversationId) ||
    listedConversation?.type === "topic"
  const topicQuery = useConversationTopic(session, conversationId, expectsTopic)
  const conversationSource = topicQuery.data?.conversation ?? listedConversation
  const memberUserIds = useMemo(
    () =>
      (conversationSource?.members ?? []).flatMap((member) =>
        member.type === "user" ? [member.id] : []
      ),
    [conversationSource]
  )
  const memberUserIdsKey = memberUserIds.slice().sort().join("\u0000")

  useEffect(() => {
    const ids = memberUserIdsKey ? memberUserIdsKey.split("\u0000") : []
    if (ids.length > 0) void ensureUsers(ids).catch(() => undefined)
  }, [ensureUsers, memberUserIdsKey])

  const conversation = useMemo(
    () =>
      conversationSource
        ? hydrateClientConversationUsers(
            conversationSource,
            contacts.apps,
            usersById
          )
        : undefined,
    [contacts.apps, conversationSource, usersById]
  )
  const pinMutation = useSetConversationPinned(session)
  const muteMutation = useSetConversationMuted(session)
  const leaveMutation = useLeaveGroupConversation(session)
  const dissolveMutation = useDissolveGroupConversation(session)
  const archiveTopicMutation = useArchiveConversationTopic(
    session,
    conversationId
  )
  const [groupActionSheetOpen, setGroupActionSheetOpen] = useState(false)
  const [topicArchiveDialogOpen, setTopicArchiveDialogOpen] = useState(false)
  const [blockDialogOpen, setBlockDialogOpen] = useState(false)

  const currentMember = conversation?.members?.find(
    (member) =>
      member.type === "user" && idsMatch(member.id, session.userId)
  )
  const isGroupOwner = currentMember?.role === "owner"
  const canManageGroup =
    isGroupOwner || currentMember?.role === "admin"
  const groupActionPending =
    leaveMutation.isPending || dissolveMutation.isPending
  const preferenceMutationPending =
    muteMutation.isPending || pinMutation.isPending
  const topicArchived = Boolean(conversation?.topic?.archived)
  const canArchiveTopic = Boolean(topicQuery.data?.canArchive) && !topicArchived
  const directContact =
    conversation?.type === "direct"
      ? conversation.members?.find(
          (member) =>
            member.type === "user" && !idsMatch(member.id, session.userId)
        )
      : undefined
  const directContactId = directContact?.id
  const directContactName =
    directContact?.nickname.trim() || directContact?.name.trim() || "该用户"
  const blockStatusQuery = useUserBlockStatus(
    session,
    directContactId ?? "",
    Boolean(directContactId)
  )
  const blockMutation = useSetUserBlocked(session)
  const blockActionPending =
    blockStatusQuery.isPending || blockMutation.isPending

  if (!conversation) {
    const loading = !isReady || (expectsTopic && topicQuery.isPending)
    return (
      <View style={[styles.screen, { backgroundColor: colors.background0 }]}>
        <AppHeader onBackPress={() => router.back()} title="聊天详情" />
        <View style={styles.centeredState}>
          <Text style={[styles.stateText, { color: colors.textSecondary }]}>
            {loading ? "正在加载…" : "对话不存在或已不可用"}
          </Text>
        </View>
      </View>
    )
  }

  const title =
    conversation.type === "group"
      ? `聊天信息 (${conversation.memberCount})`
      : conversation.type === "topic"
        ? "话题详情"
        : "聊天详情"

  async function setMuted(muted: boolean) {
    if (preferenceMutationPending) return
    toast.show({
      duration: 0,
      message: muted ? "正在开启消息免打扰" : "正在关闭消息免打扰",
      type: "loading",
    })
    try {
      await muteMutation.mutateAsync({ conversationId, muted })
      toast.hide()
    } catch (error) {
      toast.hide()
      showError(error, muted ? "开启消息免打扰失败" : "取消消息免打扰失败")
    }
  }

  async function setPinned(pinned: boolean) {
    if (preferenceMutationPending) return
    toast.show({
      duration: 0,
      message: pinned ? "正在置顶对话" : "正在取消置顶",
      type: "loading",
    })
    try {
      await pinMutation.mutateAsync({ conversationId, pinned })
      toast.hide()
    } catch (error) {
      toast.hide()
      showError(error, pinned ? "置顶对话失败" : "取消置顶失败")
    }
  }

  async function setBlocked(blocked: boolean) {
    if (!directContactId || blockMutation.isPending) return
    if (blocked) setBlockDialogOpen(false)
    toast.show({
      duration: 0,
      message: blocked ? "正在加入黑名单…" : "正在解除黑名单…",
      type: "loading",
    })
    try {
      await blockMutation.mutateAsync({ blocked, userId: directContactId })
      toast.hide()
      toast.show({
        message: blocked ? "已加入黑名单" : "已解除黑名单",
        modal: false,
        type: "success",
      })
    } catch (error) {
      toast.hide()
      showError(error, blocked ? "加入黑名单失败" : "解除黑名单失败")
    }
  }

  async function runGroupAction() {
    if (!currentMember || groupActionPending) {
      return
    }

    toast.show({
      duration: 0,
      message: isGroupOwner ? "正在解散群聊…" : "正在退出群聊…",
      type: "loading",
    })
    try {
      if (isGroupOwner) {
        await dissolveMutation.mutateAsync(conversationId)
      } else {
        await leaveMutation.mutateAsync(conversationId)
      }
      toast.hide()
      router.dismissTo("/messages")
    } catch (error) {
      toast.hide()
      showError(error, isGroupOwner ? "解散群聊失败" : "退出群聊失败")
    }
  }

  async function archiveTopic() {
    if (!canArchiveTopic || archiveTopicMutation.isPending) return

    try {
      await archiveTopicMutation.mutateAsync()
      setTopicArchiveDialogOpen(false)
    } catch (error) {
      showError(error, "关闭话题失败")
    }
  }

  function openMemberProfile(member: ClientConversationMember) {
    router.push(
      buildEntityDetailHref({
        id: member.id,
        type: member.type,
      })
    )
  }

  function showError(error: unknown, fallback: string) {
    toast.show({
      message: error instanceof ApiRequestError ? error.message : fallback,
      modal: false,
      type: "error",
    })
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background0 }]}>
      <AppHeader onBackPress={() => router.back()} title={title} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {conversation.type !== "topic" ? (
          <ContactArea
            conversation={conversation}
            currentUserId={session.userId}
            onAddPress={
              conversation.type === "group"
                ? () => router.push(buildAddGroupMembersHref(conversationId))
                : conversation.type === "direct" && directContactId
                  ? () =>
                      router.push(
                        buildCreateGroupConversationHref([directContactId])
                      )
                  : undefined
            }
            onMemberPress={openMemberProfile}
          />
        ) : null}

        {conversation.type === "group" ? (
          <View style={styles.section}>
            <XGUIList>
              <XGUIListItem
                onPress={
                  canManageGroup
                    ? () =>
                        router.push(
                          buildGroupConversationEditHref(conversationId, "name")
                        )
                    : undefined
                }
                title="群聊名称"
                value={conversation.name}
              />
              <XGUIListItem
                onPress={
                  canManageGroup
                    ? () =>
                        router.push(
                          buildGroupConversationEditHref(
                            conversationId,
                            "announcement"
                          )
                        )
                    : undefined
                }
                separator
                title="群公告"
                value={conversation.announcement?.trim() || "未设置"}
                valuePlaceholder={!conversation.announcement?.trim()}
              />
            </XGUIList>
          </View>
        ) : null}

        <View style={styles.section}>
          <XGUIList>
            <XGUIListItem
              title="消息免打扰"
              trailing={
                <XGUISwitch
                  accessibilityLabel="消息免打扰"
                  disabled={preferenceMutationPending}
                  dimWhenDisabled={false}
                  onValueChange={(value) => void setMuted(value)}
                  value={conversation.notificationMuted}
                />
              }
            />
            <XGUIListItem
              separator
              title="置顶对话"
              trailing={
                <XGUISwitch
                  accessibilityLabel="置顶对话"
                  disabled={preferenceMutationPending}
                  dimWhenDisabled={false}
                  onValueChange={(value) => void setPinned(value)}
                  value={conversation.pinned}
                />
              }
            />
          </XGUIList>
        </View>

        {conversation.type === "group" && currentMember ? (
          <View style={styles.section}>
            <XGUIList size="large">
              <XGUIListItem
                centerContent
                destructive
                disabled={groupActionPending}
                icon={({ color, size, strokeWidth }) => {
                  const Icon = isGroupOwner ? Trash2 : LogOut
                  return (
                    <Icon
                      color={color}
                      size={size}
                      strokeWidth={strokeWidth}
                    />
                  )
                }}
                onPress={
                  groupActionPending
                    ? undefined
                    : () => setGroupActionSheetOpen(true)
                }
                title={
                  groupActionPending
                    ? isGroupOwner
                      ? "正在解散…"
                      : "正在退出…"
                    : isGroupOwner
                      ? "解散群聊"
                      : "退出群聊"
                }
              />
            </XGUIList>
          </View>
        ) : null}

        {conversation.type === "direct" && directContactId ? (
          <View style={styles.section}>
            <XGUIList size="large">
              <XGUIListItem
                title="黑名单"
                trailing={
                  <XGUISwitch
                    accessibilityLabel="黑名单"
                    disabled={blockActionPending || blockStatusQuery.isError}
                    dimWhenDisabled={false}
                    onValueChange={(value) => {
                      if (value) setBlockDialogOpen(true)
                      else void setBlocked(false)
                    }}
                    value={blockStatusQuery.data?.blocked ?? false}
                  />
                }
              />
              <XGUIListItem
                onPress={() =>
                  router.push(buildConversationReportHref(conversationId))
                }
                separator
                title="举报"
              />
            </XGUIList>
          </View>
        ) : null}

        {conversation.type === "topic" && canArchiveTopic ? (
          <View style={styles.actionSection}>
            <XGUIButton
              accessibilityLabel="关闭话题"
              disabled={archiveTopicMutation.isPending}
              onPress={() => setTopicArchiveDialogOpen(true)}
              variant="danger"
            >
              {archiveTopicMutation.isPending ? "关闭中…" : "关闭话题"}
            </XGUIButton>
          </View>
        ) : null}
      </ScrollView>

      {conversation.type === "group" && currentMember ? (
        <XGUIActionSheet
          actions={[
            {
              destructive: true,
              disabled: groupActionPending,
              label: isGroupOwner ? "确认解散" : "确认退出",
              onPress: () => void runGroupAction(),
            },
          ]}
          description={
            isGroupOwner
              ? "解散后，所有成员将无法继续访问该群聊。"
              : "退出后，你将无法继续接收该群聊的消息。"
          }
          onOpenChange={setGroupActionSheetOpen}
          open={groupActionSheetOpen}
          title={isGroupOwner ? "确认解散群聊？" : "确认退出群聊？"}
        />
      ) : null}

      <XGUIDialog
        actions={[
          {
            label: "取消",
            onPress: () => setBlockDialogOpen(false),
          },
          {
            disabled: blockMutation.isPending,
            label: blockMutation.isPending ? "正在加入…" : "加入黑名单",
            onPress: () => void setBlocked(true),
            variant: "destructive",
          },
        ]}
        description={`加入黑名单后，${directContactName}将无法再向你发送私聊消息，但你仍可向对方发送消息。`}
        onOpenChange={setBlockDialogOpen}
        open={blockDialogOpen}
        title={`将${directContactName}加入黑名单？`}
      />

      <TopicArchiveDialog
        onConfirm={() => void archiveTopic()}
        onOpenChange={setTopicArchiveDialogOpen}
        open={topicArchiveDialogOpen}
        saving={archiveTopicMutation.isPending}
      />
    </View>
  )
}

function ContactArea({
  conversation,
  currentUserId,
  onAddPress,
  onMemberPress,
}: {
  conversation: ClientConversation
  currentUserId: string
  onAddPress?: () => void
  onMemberPress: (member: ClientConversationMember) => void
}) {
  const { colors } = useXGUITheme()
  const [contactAreaWidth, setContactAreaWidth] = useState(0)
  const members =
    conversation.type === "group"
      ? (conversation.members ?? [])
      : conversation.type === "direct"
        ? (conversation.members ?? []).filter(
            (member) =>
              member.type === "user" && !idsMatch(member.id, currentUserId)
          )
        : (conversation.members ?? []).filter((member) => member.type === "app")
  const canRemoveGroupMembers =
    conversation.type === "group" &&
    conversation.members?.some(
      (member) =>
        member.type === "user" &&
        idsMatch(member.id, currentUserId) &&
        (member.role === "owner" || member.role === "admin")
    )
  const tileCount = members.length + 1 + (canRemoveGroupMembers ? 1 : 0)
  const memberGridMetrics = getMemberGridMetrics(contactAreaWidth, tileCount)

  return (
    <View
      onLayout={(event) => {
        const nextWidth = Math.round(event.nativeEvent.layout.width)
        setContactAreaWidth((current) =>
          current === nextWidth ? current : nextWidth
        )
      }}
      style={[styles.contactArea, { backgroundColor: colors.background2 }]}
    >
      <View
        style={[
          styles.memberGrid,
          memberGridMetrics
            ? {
                columnGap: memberGridMetrics.columnGap,
                width: memberGridMetrics.width,
              }
            : null,
        ]}
      >
        {members.map((member) => (
          <MemberTile
            key={`${member.type}:${member.id}`}
            member={member}
            onPress={() => onMemberPress(member)}
          />
        ))}
        <PlaceholderMemberTile
          icon="plus"
          label="添加"
          onPress={onAddPress}
        />
        {canRemoveGroupMembers ? (
          <PlaceholderMemberTile icon="minus" label="移除" />
        ) : null}
      </View>
    </View>
  )
}

function MemberTile({
  member,
  onPress,
}: {
  member: ClientConversationMember
  onPress: () => void
}) {
  const session = useAuthenticatedSession()
  const { colors } = useXGUITheme()
  const displayName = member.nickname.trim() || member.name.trim() || "未命名"

  return (
    <Pressable
      accessibilityLabel={`查看${displayName}的资料`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.memberTile}
    >
      <AppAvatar
        accessibilityLabel={displayName}
        avatar={member.avatar}
        server={session}
        size={MEMBER_AVATAR_SIZE}
        type={member.type}
      />
      <Text
        numberOfLines={1}
        style={[styles.memberName, { color: colors.textSecondary }]}
      >
        {displayName}
      </Text>
    </Pressable>
  )
}

function PlaceholderMemberTile({
  icon,
  label,
  onPress,
}: {
  icon: "minus" | "plus"
  label: string
  onPress?: () => void
}) {
  const { colors } = useXGUITheme()
  const Icon = icon === "plus" ? Plus : Minus

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.memberTile}
    >
      <View
        style={[
          styles.placeholderAvatar,
          {
            borderColor: colors.foreground4,
          },
        ]}
      >
        <Icon color={colors.textPlaceholder} size={30} strokeWidth={1.5} />
      </View>
      <Text style={[styles.memberName, { color: colors.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  )
}

function getMemberGridMetrics(containerWidth: number, tileCount: number) {
  const availableWidth = containerWidth - 32
  if (availableWidth <= 0 || tileCount <= 0) return null

  const fittingColumns = Math.max(
    1,
    Math.floor(
      (availableWidth + MEMBER_MIN_COLUMN_GAP) /
        (MEMBER_TILE_WIDTH + MEMBER_MIN_COLUMN_GAP)
    )
  )
  const columns = Math.min(fittingColumns, tileCount)
  if (columns === 1) {
    return { columnGap: 0, width: MEMBER_TILE_WIDTH }
  }

  const flexibleGap =
    (availableWidth - columns * MEMBER_TILE_WIDTH) / (columns - 1)
  const columnGap = Math.min(
    MEMBER_MAX_COLUMN_GAP,
    Math.max(MEMBER_MIN_COLUMN_GAP, flexibleGap)
  )

  return {
    columnGap,
    width: columns * MEMBER_TILE_WIDTH + (columns - 1) * columnGap,
  }
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}

function idsMatch(left: string, right: string) {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase()
}

const styles = StyleSheet.create({
  actionSection: {
    paddingHorizontal: 16,
    paddingTop: 24,
  },
  centeredState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  contactArea: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  memberGrid: {
    alignSelf: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: MEMBER_ROW_GAP,
  },
  memberName: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
    textAlign: "center",
    width: MEMBER_TILE_WIDTH,
  },
  memberTile: {
    alignItems: "center",
    width: MEMBER_TILE_WIDTH,
  },
  placeholderAvatar: {
    alignItems: "center",
    borderRadius: 7,
    borderStyle: "dashed",
    borderWidth: 1,
    height: MEMBER_AVATAR_SIZE,
    justifyContent: "center",
    width: MEMBER_AVATAR_SIZE,
  },
  screen: {
    flex: 1,
  },
  section: {},
  stateText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
})
