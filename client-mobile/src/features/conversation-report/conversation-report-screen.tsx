import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { ChevronRight } from "lucide-react-native"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native"
import { YStack } from "tamagui"

import { AppAvatar } from "@/components/avatar/app-avatar"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { AppHeader } from "@/components/navigation/app-header"
import { ApiRequestError } from "@/data/api-client"
import { useCreateUserReport } from "@/data/reports/report-hooks"
import {
  USER_REPORT_REASONS,
  type UserReportReason,
} from "@/data/reports/reports-api"
import {
  countReportDescriptionCharacters,
  limitReportDescription,
} from "@/data/reports/report-text"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import {
  hydrateClientConversationUsers,
  useClientData,
} from "@/providers/client-data-provider"
import {
  XGUIActionSheet,
  XGUIButton,
  XGUIDialog,
  XGUIInformationBar,
  XGUIList,
  XGUIListItem,
  useXGUITheme,
  useXGUIToast,
} from "@/xgui"

const DESCRIPTION_MAX_LENGTH = 500

export function ConversationReportScreen() {
  const params = useLocalSearchParams<{
    conversationId?: string | string[]
  }>()
  const conversationId = firstParam(params.conversationId)
  const router = useRouter()
  const session = useAuthenticatedSession()
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const createReportMutation = useCreateUserReport(session)
  const submittingRef = useRef(false)
  const { contacts, conversations, ensureUsers, usersById } = useClientData()
  const source = conversations.find(
    (conversation) =>
      conversation.id === conversationId && conversation.type === "direct"
  )
  const targetId = source?.members?.find(
    (member) =>
      member.type === "user" && !idsMatch(member.id, session.userId)
  )?.id

  useEffect(() => {
    if (targetId) void ensureUsers([targetId]).catch(() => undefined)
  }, [ensureUsers, targetId])

  const conversation = useMemo(
    () =>
      source
        ? hydrateClientConversationUsers(source, contacts.apps, usersById)
        : undefined,
    [contacts.apps, source, usersById]
  )
  const target = conversation?.members?.find(
    (member) =>
      member.type === "user" && !idsMatch(member.id, session.userId)
  )
  const targetName = target?.nickname.trim() || target?.name.trim() || "未知用户"
  const [reason, setReason] = useState<UserReportReason | "">("")
  const [description, setDescription] = useState("")
  const [reasonSheetOpen, setReasonSheetOpen] = useState(false)
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
  const hasDraft = Boolean(reason || description.trim())
  const canSubmit = Boolean(target && reason && description.trim())
  const descriptionLength = countReportDescriptionCharacters(description)
  const reasonLabel = USER_REPORT_REASONS.find(
    (item) => item.value === reason
  )?.label

  const requestBack = useCallback(() => {
    if (hasDraft) {
      setDiscardDialogOpen(true)
      return
    }
    router.back()
  }, [hasDraft, router, setDiscardDialogOpen])

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (reasonSheetOpen || discardDialogOpen) return false
          requestBack()
          return true
        }
      )
      return () => subscription.remove()
    }, [discardDialogOpen, reasonSheetOpen, requestBack])
  )

  async function submitReport() {
    if (!reason) {
      toast.show({
        message: "请选择举报原因",
        modal: false,
        type: "error",
      })
      return
    }
    if (!description.trim()) {
      toast.show({
        message: "请填写举报描述",
        modal: false,
        type: "error",
      })
      return
    }
    if (!target) {
      toast.show({
        message: "无法确定举报用户，请返回聊天详情后重试",
        modal: false,
        type: "error",
      })
      return
    }
    if (submittingRef.current) return
    submittingRef.current = true

    try {
      await createReportMutation.mutateAsync({
        conversationId,
        description,
        reason,
      })
      toast.show({
        duration: 2_500,
        message: "举报已提交，我们将在 24 小时内处理",
        modal: false,
        type: "success",
      })
      router.back()
    } catch (error: unknown) {
      toast.show({
        message:
          error instanceof ApiRequestError ? error.message : "提交举报失败",
        modal: false,
        type: "error",
      })
    } finally {
      submittingRef.current = false
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background0 }]}>
      <AppHeader onBackPress={requestBack} title="举报" />
      <KeyboardAwareScreen
        contentBackground={colors.background0}
        edges={["left", "right", "bottom"]}
        px="$4"
        py="$4"
      >
        <YStack gap="$4" maxW={440} self="center" width="100%">
          {!conversation || !target ? (
            <XGUIInformationBar
              floating={false}
              message="无法确定举报用户，请返回聊天详情后重试"
              variant="warn-weak"
            />
          ) : (
            <>
              <XGUIList title="举报原因" variant="form-radio">
                <Pressable
                  accessibilityLabel={`举报原因，${reasonLabel || "请选择"}`}
                  accessibilityRole="button"
                  onPress={() => setReasonSheetOpen(true)}
                >
                  {({ pressed }) => (
                    <View style={styles.reasonSelect}>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.reasonValue,
                          {
                            color: reason
                              ? colors.textPrimary
                              : colors.textPlaceholder,
                          },
                        ]}
                      >
                        {reasonLabel || "请选择举报原因"}
                      </Text>
                      <ChevronRight
                        color={colors.textPlaceholder}
                        size={20}
                        strokeWidth={1.5}
                      />
                      {pressed ? (
                        <View
                          pointerEvents="none"
                          style={[
                            styles.reasonActiveMask,
                            { backgroundColor: colors.separator },
                          ]}
                        />
                      ) : null}
                    </View>
                  )}
                </Pressable>
              </XGUIList>

              <XGUIList title="举报用户" variant="form-radio">
                <XGUIListItem
                  description={target.name.trim() || undefined}
                  leading={
                    <AppAvatar
                      accessibilityLabel={targetName}
                      avatar={target.avatar}
                      rounded
                      server={session}
                      size={44}
                      type="user"
                    />
                  }
                  minHeight={68}
                  title={targetName}
                />
              </XGUIList>

              <View>
                <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
                  举报描述
                </Text>
                <View
                  style={[
                    styles.descriptionBox,
                    { backgroundColor: colors.background2 },
                  ]}
                >
                  <TextInput
                    accessibilityLabel="举报描述"
                    multiline
                    onChangeText={(value) =>
                      setDescription(
                        limitReportDescription(value, DESCRIPTION_MAX_LENGTH)
                      )
                    }
                    placeholder="请描述具体情况"
                    placeholderTextColor={colors.textPlaceholder}
                    style={[styles.descriptionInput, { color: colors.textPrimary }]}
                    textAlignVertical="top"
                    value={description}
                  />
                  <Text style={[styles.count, { color: colors.textPlaceholder }]}>
                    {descriptionLength}/{DESCRIPTION_MAX_LENGTH}
                  </Text>
                </View>
              </View>

              <XGUIButton
                disabled={!canSubmit || createReportMutation.isPending}
                loading={createReportMutation.isPending}
                onPress={() => void submitReport()}
              >
                {createReportMutation.isPending ? "提交中…" : "提交举报"}
              </XGUIButton>
            </>
          )}
        </YStack>
      </KeyboardAwareScreen>

      <XGUIActionSheet
        actions={USER_REPORT_REASONS.map((item) => ({
          label: item.label,
          onPress: () => setReason(item.value),
        }))}
        maxContentHeight={560}
        onOpenChange={setReasonSheetOpen}
        open={reasonSheetOpen}
        title="选择举报原因"
      />
      <XGUIDialog
        actions={[
          {
            label: "继续填写",
            onPress: () => setDiscardDialogOpen(false),
          },
          {
            label: "放弃",
            onPress: () => router.back(),
            variant: "destructive",
          },
        ]}
        description="当前填写的举报内容将不会保留。"
        onOpenChange={setDiscardDialogOpen}
        open={discardDialogOpen}
        title="放弃举报？"
      />
    </View>
  )
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}

function idsMatch(left: string, right: string) {
  return left.toLocaleLowerCase() === right.toLocaleLowerCase()
}

const styles = StyleSheet.create({
  count: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "right",
  },
  descriptionBox: {
    borderRadius: 8,
    padding: 16,
  },
  descriptionInput: {
    fontSize: 16,
    height: 80,
    lineHeight: 23,
    padding: 0,
  },
  reasonActiveMask: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  reasonSelect: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: 16,
    position: "relative",
  },
  reasonValue: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    marginRight: 16,
  },
  screen: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
})
