import { useEffect, useRef, useState } from "react"
import { useRouter } from "expo-router"
import { ChevronLeft } from "lucide-react-native"
import { Paragraph, YStack } from "tamagui"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { PageHeader } from "@/components/navigation/page-header"
import { requestAccountDeactivationCode } from "@/data/auth/account-deactivation-api"
import { normalizeDeactivationCode } from "@/features/me/account-deactivation-model"
import { useAuth, useAuthenticatedSession } from "@/providers/auth-provider"
import { XGUIButton, XGUIInformationBar, XGUIInput, useXGUITheme, useXGUIToast } from "@/xgui"

export function AccountDeactivationScreen() {
  const router = useRouter()
  const session = useAuthenticatedSession()
  const { active, activeAccount, deactivateActiveAccount, phase } = useAuth()
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const [code, setCode] = useState("")
  const [retrySeconds, setRetrySeconds] = useState(0)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [navigationTarget, setNavigationTarget] = useState<string | null | undefined>(undefined)
  const navigated = useRef(false)

  useEffect(() => {
    if (retrySeconds <= 0) return
    const timer = setTimeout(() => setRetrySeconds((value) => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [retrySeconds])

  useEffect(() => {
    const target = navigationTarget
    if (!target || navigated.current || phase !== "authenticated" || active?.accountId !== target) return
    navigated.current = true
    toast.hide()
    let second: number | undefined
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => router.dismissTo("/messages"))
    })
    return () => {
      cancelAnimationFrame(first)
      if (second !== undefined) cancelAnimationFrame(second)
    }
  }, [active?.accountId, navigationTarget, phase, router, toast])

  async function requestCode() {
    if (sending || retrySeconds > 0) return
    setSending(true)
    setErrorMessage("")
    try {
      const result = await requestAccountDeactivationCode(session)
      setRetrySeconds(result.retryAfterSeconds)
      toast.show({ message: "验证码已发送", modal: false, type: "success" })
    } catch (error) {
      const message = error instanceof Error ? error.message : "发送验证码失败，请稍后重试"
      setErrorMessage(message)
      toast.show({ message, modal: false, type: "error" })
    } finally { setSending(false) }
  }

  async function submit() {
    if (submitting || code.length !== 8) return
    setSubmitting(true)
    setErrorMessage("")
    toast.show({ duration: 0, message: "正在注销账号", type: "loading" })
    try {
      const candidateId = await deactivateActiveAccount(code)
      setNavigationTarget(candidateId)
      if (!candidateId) toast.hide()
    } catch (error) {
      toast.hide()
      const message = error instanceof Error ? error.message : "注销账号失败，请稍后重试"
      setErrorMessage(message)
      toast.show({ message, modal: false, type: "error" })
      setSubmitting(false)
    }
  }

  return (
    <YStack bg={colors.background0} flex={1}>
      <PageHeader backIcon={ChevronLeft} backIconColor={colors.textPrimary} background={colors.background0} compactIconButtons onBackPress={() => router.back()} title="注销账号" titleColor={colors.textPrimary} titleFontSize={17} titleFontWeight="600" />
      <KeyboardAwareScreen contentBackground={colors.background0} edges={["left", "right", "bottom"]} px="$4" pt="$4">
        <YStack gap="$4" maxW={440} self="center" width="100%">
          <Paragraph color={colors.textSecondary}>验证码将发送至当前账号邮箱：{activeAccount?.email?.trim() || "邮箱不可用"}</Paragraph>
          <YStack overflow="hidden" style={{ borderRadius: 8 }}>
            <XGUIInput
              autoComplete="one-time-code"
              autoFocus
              keyboardType="number-pad"
              label="验证码"
              maxLength={8}
              onChangeText={(value) => { setCode(normalizeDeactivationCode(value)); setErrorMessage("") }}
              placeholder="输入8位数字验证码"
              textContentType="oneTimeCode"
              trailing={<XGUIButton disabled={sending || retrySeconds > 0 || submitting} loading={sending} onPress={() => void requestCode()} size="mini" variant="secondary">{retrySeconds > 0 ? `${retrySeconds}秒` : "发送验证码"}</XGUIButton>}
              value={code}
            />
          </YStack>
          {errorMessage ? <XGUIInformationBar floating={false} message={errorMessage} variant="warn-weak" /> : null}
          <XGUIButton disabled={code.length !== 8 || submitting} loading={submitting} onPress={() => void submit()} variant="danger">注销账号</XGUIButton>
        </YStack>
      </KeyboardAwareScreen>
    </YStack>
  )
}
