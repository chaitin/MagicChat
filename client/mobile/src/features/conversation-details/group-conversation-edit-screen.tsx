import { useLocalSearchParams, useRouter } from "expo-router"
import { ChevronLeft } from "lucide-react-native"
import { useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import { YStack } from "tamagui"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { PageHeader } from "@/components/navigation/page-header"
import {
  useUpdateGroupConversationAnnouncement,
  useUpdateGroupConversationName,
} from "@/data/conversations/conversation-hooks"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { useClientConversations } from "@/providers/client-data-provider"
import {
  XGUIInformationBar,
  XGUIInput,
  useXGUITheme,
  useXGUIToast,
} from "@/xgui"

const GROUP_NAME_MAX_LENGTH = 120
const GROUP_ANNOUNCEMENT_MAX_LENGTH = 200

export function GroupConversationEditScreen() {
  const params = useLocalSearchParams<{
    conversationId?: string | string[]
    field?: string | string[]
  }>()
  const conversationId = firstParam(params.conversationId)
  const field = firstParam(params.field)
  const editingAnnouncement = field === "announcement"
  const validField = editingAnnouncement || field === "name"
  const router = useRouter()
  const session = useAuthenticatedSession()
  const { conversations } = useClientConversations()
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const conversation = conversations.find(
    (item) => item.id === conversationId && item.type === "group"
  )
  const currentMember = conversation?.members?.find(
    (member) =>
      member.type === "user" && idsMatch(member.id, session.userId)
  )
  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin"
  const initialValue = editingAnnouncement
    ? (conversation?.announcement ?? "")
    : (conversation?.name ?? "")
  const [value, setValue] = useState(initialValue)
  const [errorMessage, setErrorMessage] = useState("")
  const nameMutation = useUpdateGroupConversationName(session)
  const announcementMutation =
    useUpdateGroupConversationAnnouncement(session)
  const saving = nameMutation.isPending || announcementMutation.isPending
  const normalizedValue = value.trim()
  const unchanged = normalizedValue === initialValue.trim()
  const saveDisabled =
    saving ||
    !validField ||
    !canManage ||
    unchanged ||
    (!editingAnnouncement && normalizedValue.length === 0)
  const title = editingAnnouncement ? "修改群公告" : "修改群聊名称"

  async function handleSave() {
    if (saveDisabled) return

    setErrorMessage("")
    toast.show({ duration: 0, message: "正在保存…", type: "loading" })
    try {
      if (editingAnnouncement) {
        await announcementMutation.mutateAsync({
          announcement: normalizedValue,
          conversationId,
        })
      } else {
        await nameMutation.mutateAsync({
          conversationId,
          name: normalizedValue,
        })
      }
      toast.hide()
      router.back()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `${title}失败，请稍后重试`
      setErrorMessage(message)
      toast.show({ message, modal: false, type: "error" })
    }
  }

  return (
    <YStack bg={colors.background0} flex={1}>
      <PageHeader
        actionDisabled={saveDisabled}
        actionLabel="保存"
        backIcon={ChevronLeft}
        backIconColor={colors.textPrimary}
        background={colors.background0}
        compactIconButtons
        onActionPress={() => void handleSave()}
        onBackPress={() => router.back()}
        primaryAction
        subtleButtonPress={false}
        title={title}
        titleColor={colors.textPrimary}
        titleFontSize={17}
        titleFontWeight="600"
      />
      <KeyboardAwareScreen
        contentBackground={colors.background0}
        edges={["left", "right", "bottom"]}
        px="$4"
        pt="$4"
      >
        <YStack maxW={440} self="center" width="100%">
          {conversation && validField && canManage ? (
            <>
              <YStack overflow="hidden" style={{ borderRadius: 8 }}>
                <XGUIInput
                  autoFocus
                  containerStyle={
                    editingAnnouncement ? styles.announcementContainer : undefined
                  }
                  label={editingAnnouncement ? "群公告" : "群聊名称"}
                  maxLength={
                    editingAnnouncement
                      ? GROUP_ANNOUNCEMENT_MAX_LENGTH
                      : GROUP_NAME_MAX_LENGTH
                  }
                  multiline={editingAnnouncement}
                  onChangeText={(nextValue) => {
                    setValue(nextValue)
                    setErrorMessage("")
                  }}
                  onSubmitEditing={
                    editingAnnouncement ? undefined : () => void handleSave()
                  }
                  placeholder={
                    editingAnnouncement ? "输入群公告" : "输入群聊名称"
                  }
                  returnKeyType={editingAnnouncement ? "default" : "done"}
                  style={editingAnnouncement ? styles.announcementInput : undefined}
                  textAlignVertical={editingAnnouncement ? "top" : "center"}
                  value={value}
                />
              </YStack>
              {editingAnnouncement ? (
                <Text
                  style={[styles.count, { color: colors.textSecondary }]}
                >
                  {value.length}/{GROUP_ANNOUNCEMENT_MAX_LENGTH}
                </Text>
              ) : null}
              {errorMessage ? (
                <XGUIInformationBar
                  floating={false}
                  message={errorMessage}
                  style={{ marginTop: 16 }}
                  variant="warn-weak"
                />
              ) : null}
            </>
          ) : (
            <View style={styles.unavailable}>
              <Text style={{ color: colors.textSecondary }}>
                {!conversation
                  ? "群聊不存在或已不可用"
                  : !validField
                    ? "编辑项目不存在"
                    : "只有群主或管理员可以修改"}
              </Text>
            </View>
          )}
        </YStack>
      </KeyboardAwareScreen>
    </YStack>
  )
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}

function idsMatch(left: string, right: string) {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase()
}

const styles = StyleSheet.create({
  announcementContainer: {
    alignItems: "flex-start",
    minHeight: 176,
    paddingVertical: 16,
  },
  announcementInput: {
    minHeight: 144,
  },
  count: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    textAlign: "right",
  },
  unavailable: {
    alignItems: "center",
    paddingVertical: 48,
  },
})
