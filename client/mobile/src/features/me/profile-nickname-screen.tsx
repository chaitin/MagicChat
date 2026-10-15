import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { ChevronLeft } from "lucide-react-native"
import { View } from "react-native"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { PageHeader } from "@/components/navigation/page-header"
import { queryKeys } from "@/data/query"
import { contactManager } from "@/data/contacts"
import { updateCurrentUserNickname } from "@/data/users/current-user-api"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { useClientSession } from "@/providers/client-data-provider"
import {
  XGUIInformationBar,
  XGUIInput,
  useXGUITheme,
  useXGUIToast,
} from "@/xgui"

export function ProfileNicknameScreen() {
  const router = useRouter()
  const session = useAuthenticatedSession()
  const { currentUser } = useClientSession()
  const queryClient = useQueryClient()
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const [nickname, setNickname] = useState(currentUser?.nickname ?? "")
  const [errorMessage, setErrorMessage] = useState("")
  const [saving, setSaving] = useState(false)
  const normalizedNickname = nickname.trim()
  const unchanged = normalizedNickname === (currentUser?.nickname ?? "").trim()

  async function handleSave() {
    if (saving || unchanged) return
    setSaving(true)
    setErrorMessage("")
    toast.show({ duration: 0, message: "正在保存…", type: "loading" })
    try {
      await updateCurrentUserNickname(session, normalizedNickname)
      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: queryKeys.currentUser(session) }),
        contactManager.refreshUsers(session, [session.userId]),
        queryClient.invalidateQueries({ queryKey: queryKeys.conversations(session) }),
      ])
      toast.hide()
      router.back()
    } catch (error) {
      const message = error instanceof Error ? error.message : "修改昵称失败，请稍后重试"
      setErrorMessage(message)
      toast.show({ message, modal: false, type: "error" })
      setSaving(false)
    }
  }

  return (
    <View style={{ backgroundColor: colors.background0, flex: 1 }}>
      <PageHeader
        actionDisabled={saving || unchanged}
        actionLabel="保存"
        backIcon={ChevronLeft}
        backIconColor={colors.textPrimary}
        background={colors.background0}
        compactIconButtons
        onActionPress={() => void handleSave()}
        onBackPress={() => router.back()}
        primaryAction
        subtleButtonPress={false}
        title="修改昵称"
        titleColor={colors.textPrimary}
        titleFontSize={16}
        titleFontWeight="600"
      />
      <KeyboardAwareScreen
        contentBackground={colors.background0}
        contentStyle={{ paddingHorizontal: 18, paddingTop: 18 }}
        edges={["left", "right", "bottom"]}
      >
        <View style={{ alignSelf: "center", maxWidth: 440, width: "100%" }}>
          <View style={{ borderRadius: 8, overflow: "hidden" }}>
            <XGUIInput
              autoFocus
              label="昵称"
              maxLength={64}
              onChangeText={(value) => {
                setNickname(value)
                setErrorMessage("")
              }}
              onSubmitEditing={() => void handleSave()}
              placeholder="输入昵称"
              returnKeyType="done"
              value={nickname}
            />
          </View>
          {errorMessage ? (
            <XGUIInformationBar
              floating={false}
              message={errorMessage}
              style={{ marginTop: 16 }}
              variant="warn-weak"
            />
          ) : null}
        </View>
      </KeyboardAwareScreen>
    </View>
  )
}
