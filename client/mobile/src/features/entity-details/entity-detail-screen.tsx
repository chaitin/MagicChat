import { useLocalSearchParams, useRouter } from "expo-router"
import { useEffect, useMemo, useState } from "react"
import { Alert, ScrollView, StyleSheet, View } from "react-native"

import { ContentState } from "@/components/feedback/content-state"
import { isSvgUrl } from "@/components/avatar/cached-avatar-image"
import { AppHeader } from "@/components/navigation/app-header"
import { ApiRequestError } from "@/data/api-client"
import { useOpenEntityConversation } from "@/data/conversations/conversation-hooks"
import type { ServerTarget } from "@/core/server-target"
import {
  isEntityType,
  resolveEntityProfile,
  type EntityProfile,
  type EntityType,
} from "@/domain/entities/entity-profile"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { EntityDetailAction } from "@/features/entity-details/entity-detail-action"
import { EntityDetailAvatar } from "@/features/entity-details/entity-detail-avatar"
import { EntityDetailFields } from "@/features/entity-details/entity-detail-fields"
import { useClientData } from "@/providers/client-data-provider"
import {
  MediaLibraryPermissionError,
  saveImageToMediaLibrary,
  useCachedAvatar,
} from "@/data/resources"
import { buildConversationHref } from "@/navigation/conversations"
import {
  XGUIGallery,
  XGUIList,
  XGUIListItem,
  useXGUITheme,
  useXGUIToast,
} from "@/xgui"

export function EntityDetailScreen() {
  const params = useLocalSearchParams<{
    entityId: string
    entityType: string
  }>()
  const router = useRouter()
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const session = useAuthenticatedSession()
  const {
    contacts,
    conversations,
    currentUser,
    ensureUsers,
    isReady,
    usersById,
  } = useClientData()
  const openConversationMutation = useOpenEntityConversation(session)
  const entityId = getFirstParam(params.entityId)
  const entityTypeParam = getFirstParam(params.entityType)
  const entityType = isEntityType(entityTypeParam) ? entityTypeParam : null
  useEffect(() => {
    if (entityType === "user" && entityId) {
      void ensureUsers([entityId]).catch(() => undefined)
    }
  }, [ensureUsers, entityId, entityType])
  const profileContacts = useMemo(
    () => ({ ...contacts, users: Object.values(usersById) }),
    [contacts, usersById]
  )
  const isResolvingUserProfile =
    entityType === "user" && Boolean(entityId) && !usersById[entityId]
  const profile = useMemo(
    () =>
      entityType && entityId
        ? resolveEntityProfile({
            contacts: profileContacts,
            conversations,
            currentUser,
            reference: { id: entityId, type: entityType },
          })
        : null,
    [conversations, currentUser, entityId, entityType, profileContacts]
  )

  async function handlePrimaryAction() {
    if (!profile || openConversationMutation.isPending) return

    const hasListedGroupConversation =
      profile.type === "group" &&
      conversations.some((conversation) => conversation.id === profile.id)
    if (profile.type === "group" && profile.joined && hasListedGroupConversation) {
      router.push(buildConversationHref(profile.id))
      return
    }

    toast.show({
      duration: 0,
      message:
        profile.type === "group"
          ? profile.joined
            ? "正在打开群聊"
            : "正在加入群聊"
          : "正在发起会话",
      type: "loading",
    })

    try {
      const conversation = await openConversationMutation.mutateAsync({
        id: profile.id,
        joined: profile.type === "group" ? profile.joined : undefined,
        type: profile.type,
      })
      toast.hide()
      router.push(buildConversationHref(conversation.id))
    } catch (error: unknown) {
      toast.hide()
      Alert.alert(
        getActionErrorTitle(profile),
        error instanceof ApiRequestError ? error.message : "操作失败，请重试。"
      )
    }
  }

  return (
    <View style={{ backgroundColor: colors.background0, flex: 1 }}>
      <AppHeader
        onBackPress={() => router.back()}
        title={getPageTitle(entityType)}
      />

      {(!isReady || isResolvingUserProfile) && entityType ? (
        <ContentState loading message="正在加载资料" />
      ) : profile ? (
        <EntityProfileContent
          currentUserId={currentUser?.id ?? null}
          isActionPending={openConversationMutation.isPending}
          onActionPress={() => void handlePrimaryAction()}
          profile={profile}
          server={session}
        />
      ) : (
        <ContentState message="资料不存在或已不可访问" />
      )}
    </View>
  )
}

function EntityProfileContent({
  currentUserId,
  isActionPending,
  onActionPress,
  profile,
  server,
}: {
  currentUserId: string | null
  isActionPending: boolean
  onActionPress: () => void
  profile: EntityProfile
  server: ServerTarget
}) {
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [isSavingAvatar, setIsSavingAvatar] = useState(false)
  const avatarResource = useCachedAvatar(server, profile.avatar)
  const canPreviewAvatar = Boolean(profile.avatar.trim() && avatarResource.uri)

  async function handleSaveAvatar() {
    if (!avatarResource.resource || isSavingAvatar) return
    setIsSavingAvatar(true)

    try {
      await saveImageToMediaLibrary(avatarResource.resource)
      toast.show({
        duration: 1_000,
        message: "头像已保存到系统相册",
        modal: false,
        type: "text",
      })
    } catch (error: unknown) {
      toast.show({
        duration: 1_000,
        message:
          error instanceof MediaLibraryPermissionError
            ? "请在系统设置中允许即应访问相册"
            : error instanceof Error
              ? error.message
              : "头像保存失败，请稍后重试",
        modal: false,
        type: "text",
      })
    } finally {
      setIsSavingAvatar(false)
    }
  }

  return (
    <>
      <ScrollView
      contentContainerStyle={styles.scrollContent}
      style={{ backgroundColor: colors.background0 }}
    >
      <View style={styles.content}>
        <XGUIList>
          <XGUIListItem
            description={getProfileDescription(profile)}
            descriptionFontSize={16}
            descriptionNumberOfLines={3}
            leading={
            <EntityDetailAvatar
              onPress={canPreviewAvatar ? () => setGalleryOpen(true) : undefined}
              profile={profile}
              server={server}
            />
            }
            minHeight={60}
            title={profile.displayName}
            titleFontSize={20}
            titleNumberOfLines={2}
          />
        </XGUIList>

        <EntityDetailFields profile={profile} />
        <EntityDetailAction
          currentUserId={currentUserId}
          isPending={isActionPending}
          onPress={onActionPress}
          profile={profile}
        />
      </View>
      </ScrollView>
      {avatarResource.uri ? (
        <XGUIGallery
          accessibilityLabel={`${profile.displayName}的头像`}
          onOpenChange={setGalleryOpen}
          onSave={() => void handleSaveAvatar()}
          open={galleryOpen}
          saving={isSavingAvatar}
          source={{
            uri: avatarResource.uri,
            svg: isSvgUrl(avatarResource.sourceUrl),
          }}
        />
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  content: {
    alignSelf: "center",
    maxWidth: 440,
    width: "100%",
  },
  scrollContent: {
    paddingBottom: 24,
  },
})

function getProfileDescription(profile: EntityProfile) {
  if (profile.type === "user") return "用户资料"
  if (profile.type === "group") return "群聊资料"
  return profile.description.trim() || "应用资料"
}

function getPageTitle(type: EntityType | null) {
  if (type === "app") return "应用详情"
  if (type === "group") return "群组详情"
  return "联系人详情"
}

function getActionErrorTitle(profile: EntityProfile) {
  if (profile.type === "user") return "无法发起私聊"
  if (profile.type === "app") return "无法发起应用会话"
  return profile.joined ? "无法打开群聊" : "无法加入群聊"
}

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}
