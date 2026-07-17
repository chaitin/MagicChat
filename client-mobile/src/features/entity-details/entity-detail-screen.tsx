import { useLocalSearchParams, useRouter } from "expo-router"
import { useMemo } from "react"
import { Alert } from "react-native"
import { Card, Paragraph, ScrollView, XStack, YStack } from "tamagui"

import { ContentState } from "@/components/feedback/content-state"
import { PageHeader } from "@/components/navigation/page-header"
import { ApiRequestError } from "@/data/api-client"
import { useOpenEntityConversation } from "@/data/conversation-hooks"
import type { ServerTarget } from "@/data/query"
import {
  isEntityType,
  resolveEntityProfile,
  type EntityProfile,
  type EntityType,
} from "@/domain/entities/entity-profile"
import { useAuthenticatedSession } from "@/features/auth/auth-context"
import { EntityDetailAction } from "@/features/entity-details/entity-detail-action"
import { EntityDetailAvatar } from "@/features/entity-details/entity-detail-avatar"
import { EntityDetailFields } from "@/features/entity-details/entity-detail-fields"
import { useClientData } from "@/providers/client-data-provider"
import { buildConversationHref } from "@/navigation/conversations"

export function EntityDetailScreen() {
  const params = useLocalSearchParams<{
    entityId: string
    entityType: string
  }>()
  const router = useRouter()
  const session = useAuthenticatedSession()
  const { contacts, conversations, currentUser, isReady } = useClientData()
  const openConversationMutation = useOpenEntityConversation(session)
  const entityId = getFirstParam(params.entityId)
  const entityTypeParam = getFirstParam(params.entityType)
  const entityType = isEntityType(entityTypeParam) ? entityTypeParam : null
  const profile = useMemo(
    () =>
      entityType && entityId
        ? resolveEntityProfile({
            contacts,
            conversations,
            currentUser,
            reference: { id: entityId, type: entityType },
          })
        : null,
    [contacts, conversations, currentUser, entityId, entityType]
  )

  async function handlePrimaryAction() {
    if (!profile || openConversationMutation.isPending) return

    if (profile.type === "group" && profile.joined) {
      router.push(buildConversationHref(profile.id))
      return
    }

    try {
      const conversation = await openConversationMutation.mutateAsync({
        id: profile.id,
        type: profile.type,
      })
      router.push(buildConversationHref(conversation.id))
    } catch (error: unknown) {
      Alert.alert(
        getActionErrorTitle(profile),
        error instanceof ApiRequestError ? error.message : "操作失败，请重试。"
      )
    }
  }

  return (
    <YStack bg="$background" flex={1}>
      <PageHeader
        onBackPress={() => router.back()}
        title={getPageTitle(entityType)}
      />

      {!isReady && entityType ? (
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
    </YStack>
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
  return (
    <ScrollView>
      <YStack gap="$4" maxW={440} p="$4" self="center" width="100%">
        <Card size="$5">
          <XStack gap="$4" items="center">
            <EntityDetailAvatar profile={profile} server={server} />
            <YStack flex={1} gap="$1">
              <Paragraph
                fontSize="$5"
                fontWeight="600"
                lineHeight="$6"
                numberOfLines={2}
              >
                {profile.displayName}
              </Paragraph>
              <Paragraph color="$color10" numberOfLines={3} size="$3">
                {getProfileDescription(profile)}
              </Paragraph>
            </YStack>
          </XStack>
        </Card>

        <EntityDetailFields profile={profile} />
        <EntityDetailAction
          currentUserId={currentUserId}
          isPending={isActionPending}
          onPress={onActionPress}
          profile={profile}
        />
      </YStack>
    </ScrollView>
  )
}

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
  return "无法加入群聊"
}

function getFirstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}
