import { useEffect, useRef, useState } from "react"
import {
  AlertDialog,
  Button,
  Card,
  Spinner,
  type TamaguiElement,
  useToastController,
  XStack,
  YStack,
} from "tamagui"

import type { AppToastTone } from "@/components/feedback/app-toast"
import { AppButton } from "@/components/forms/app-button"
import { AppInput } from "@/components/forms/app-input"
import { PasswordInput } from "@/components/forms/password-input"
import { ApiRequestError } from "@/data/api-client"
import {
  loadLoginCredentials,
  saveLoginAccount,
  saveLoginCredentials,
} from "@/data/auth-credential-store"
import {
  useEmailCodeLoginMutation,
  useLoginMutation,
  useRequestEmailCodeMutation,
} from "@/data/hooks"
import type { ServerTarget } from "@/data/query"
import { EmailCodeInput } from "@/features/auth/email-code-input"
import {
  LoginMethodTabs,
  resolveLoginMethod,
  type LoginMethod,
} from "@/features/auth/login-method-tabs"
import { SelectedServerButton } from "@/features/servers/selected-server-button"

const ACCOUNT_INPUT_ID = "login-account"
const EMAIL_CODE_INPUT_ID = "login-email-code"
const PASSWORD_INPUT_ID = "login-password"
const EMAIL_CODE_RETRY_SECONDS = 15

type LoginFormState = {
  account: string
  emailCode: string
  isLoading: boolean
  password: string
  serverKey: string
}

type LoginFeedback = {
  message: string
  serverKey: string
  title: string
}

type RetryCodeState = {
  seconds: number
  serverKey: string
}

export function LoginForm({
  emailCodeLoginEnabled,
  onLoginSuccess,
  passwordLoginEnabled,
  server,
}: {
  emailCodeLoginEnabled: boolean
  onLoginSuccess: () => void
  passwordLoginEnabled: boolean
  server: ServerTarget
}) {
  const passwordLoginMutation = useLoginMutation(server)
  const emailCodeLoginMutation = useEmailCodeLoginMutation(server)
  const requestEmailCodeMutation = useRequestEmailCodeMutation(server)
  const toast = useToastController()
  const accountInputRef = useRef<TamaguiElement>(null)
  const emailCodeInputRef = useRef<TamaguiElement>(null)
  const passwordInputRef = useRef<TamaguiElement>(null)
  const serverKey = `${server.id}\n${server.url}`
  const [formState, setFormState] = useState<LoginFormState>({
    account: "",
    emailCode: "",
    isLoading: true,
    password: "",
    serverKey: "",
  })
  const [preferredLoginMethod, setPreferredLoginMethod] =
    useState<LoginMethod>("email-code")
  const [retryCodeState, setRetryCodeState] = useState<RetryCodeState>({
    seconds: 0,
    serverKey: "",
  })
  const [feedback, setFeedback] = useState<LoginFeedback | null>(null)
  const isCurrentServer = formState.serverKey === serverKey
  const account = isCurrentServer ? formState.account : ""
  const emailCode = isCurrentServer ? formState.emailCode : ""
  const password = isCurrentServer ? formState.password : ""
  const isCredentialsLoading = !isCurrentServer || formState.isLoading
  const visibleFeedback = feedback?.serverKey === serverKey ? feedback : null
  const retryCodeAfter =
    retryCodeState.serverKey === serverKey ? retryCodeState.seconds : 0
  const activeLoginMethod = resolveLoginMethod({
    emailCodeLoginEnabled,
    passwordLoginEnabled,
    preferredMethod: preferredLoginMethod,
  })
  const isPending =
    passwordLoginMutation.isPending ||
    emailCodeLoginMutation.isPending ||
    requestEmailCodeMutation.isPending
  const canSignIn =
    !isCredentialsLoading &&
    account.trim().length > 0 &&
    (activeLoginMethod === "email-code"
      ? emailCode.length === 8
      : activeLoginMethod === "password"
        ? password.length > 0
        : false)
  const isSignInDisabled = !canSignIn || isPending

  useEffect(() => {
    let isCancelled = false

    void loadLoginCredentials({ id: server.id, url: server.url })
      .then((credentials) => {
        if (!isCancelled) {
          setFormState({
            account: credentials?.account ?? "",
            emailCode: "",
            isLoading: false,
            password: credentials?.password ?? "",
            serverKey,
          })
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setFormState({
            account: "",
            emailCode: "",
            isLoading: false,
            password: "",
            serverKey,
          })
        }
      })

    return () => {
      isCancelled = true
    }
  }, [server.id, server.url, serverKey])

  useEffect(() => {
    if (retryCodeAfter <= 0) return

    const timer = setTimeout(
      () =>
        setRetryCodeState((current) =>
          current.serverKey === serverKey
            ? { ...current, seconds: Math.max(0, current.seconds - 1) }
            : current
        ),
      1000
    )
    return () => clearTimeout(timer)
  }, [retryCodeAfter, serverKey])

  function handleAccountChange(value: string) {
    setFormState((current) => ({
      account: value,
      emailCode: current.serverKey === serverKey ? current.emailCode : "",
      isLoading: false,
      password: current.serverKey === serverKey ? current.password : "",
      serverKey,
    }))
  }

  function handlePasswordChange(value: string) {
    setFormState((current) => ({
      account: current.serverKey === serverKey ? current.account : "",
      emailCode: current.serverKey === serverKey ? current.emailCode : "",
      isLoading: false,
      password: value,
      serverKey,
    }))
  }

  function handleEmailCodeChange(value: string) {
    setFormState((current) => ({
      account: current.serverKey === serverKey ? current.account : "",
      emailCode: value.replace(/\D/g, "").slice(0, 8),
      isLoading: false,
      password: current.serverKey === serverKey ? current.password : "",
      serverKey,
    }))
  }

  function showFeedback(title: string, message: string) {
    setFeedback({ message, serverKey, title })
  }

  async function handleRequestEmailCode() {
    if (isCredentialsLoading || isPending || retryCodeAfter > 0) return

    const email = account.trim()
    if (!email) {
      showFeedback("无法获取验证码", "请输入邮箱地址")
      accountInputRef.current?.focus()
      return
    }

    setFeedback(null)

    try {
      await requestEmailCodeMutation.mutateAsync(email)
      setRetryCodeState({
        seconds: EMAIL_CODE_RETRY_SECONDS,
        serverKey,
      })
      toast.show("验证码已发送", {
        customData: { tone: "success" satisfies AppToastTone },
        message: "请查收邮箱中的验证码",
      })
    } catch (error: unknown) {
      toast.show("验证码发送失败", {
        customData: { tone: "error" satisfies AppToastTone },
        duration: 4000,
        message:
          error instanceof ApiRequestError ? error.message : "请稍后重试",
      })
    }
  }

  async function handleSignIn(method: LoginMethod) {
    if (!canSignIn || isPending || activeLoginMethod !== method) return

    setFeedback(null)

    try {
      if (method === "password") {
        await passwordLoginMutation.mutateAsync({ account, password })
        await saveLoginCredentials(server, { account, password }).catch(() => {
          // A successful login must not be blocked by local credential storage.
        })
      } else {
        await emailCodeLoginMutation.mutateAsync({
          code: emailCode,
          email: account,
        })
        await saveLoginAccount(server, account).catch(() => {
          // A successful login must not be blocked by local credential storage.
        })
      }
      onLoginSuccess()
    } catch (error: unknown) {
      showFeedback(
        "登录失败",
        error instanceof ApiRequestError ? error.message : "登录失败"
      )
    }
  }

  return (
    <>
      <Card size="$5">
        <YStack gap="$4" p="$4">
          <SelectedServerButton disabled={isPending} />

          <LoginMethodTabs
            activeMethod={activeLoginMethod}
            disabled={isPending}
            emailCodeContent={
              <YStack gap="$4">
                <AppInput
                  accessibilityLabel="邮箱"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  bg="$color1"
                  color="$gray12"
                  disabled={isCredentialsLoading || isPending}
                  id={ACCOUNT_INPUT_ID}
                  keyboardType="email-address"
                  onChangeText={handleAccountChange}
                  onSubmitEditing={() => emailCodeInputRef.current?.focus()}
                  placeholder="输入邮箱"
                  placeholderTextColor="$gray9"
                  ref={accountInputRef}
                  returnKeyType="next"
                  spellCheck={false}
                  value={account}
                />

                <EmailCodeInput
                  accessibilityLabel="邮箱验证码"
                  actionDisabled={
                    isCredentialsLoading ||
                    isPending ||
                    retryCodeAfter > 0 ||
                    account.trim().length === 0
                  }
                  actionLabel={
                    requestEmailCodeMutation.isPending
                      ? "发送中"
                      : retryCodeAfter > 0
                        ? `${retryCodeAfter} 秒`
                        : "获取验证码"
                  }
                  actionLoading={requestEmailCodeMutation.isPending}
                  autoCapitalize="none"
                  autoComplete="one-time-code"
                  bg="$color1"
                  color="$gray12"
                  disabled={isCredentialsLoading || isPending}
                  id={EMAIL_CODE_INPUT_ID}
                  keyboardType="number-pad"
                  onActionPress={() => void handleRequestEmailCode()}
                  onChangeText={handleEmailCodeChange}
                  onSubmitEditing={() => void handleSignIn("email-code")}
                  placeholder="邮箱验证码"
                  placeholderTextColor="$gray9"
                  ref={emailCodeInputRef}
                  returnKeyType="done"
                  textContentType="oneTimeCode"
                  value={emailCode}
                />

                <LoginButton
                  disabled={isSignInDisabled}
                  isLoading={emailCodeLoginMutation.isPending}
                  onPress={() => void handleSignIn("email-code")}
                  testID="email-code-login-submit-button"
                />
              </YStack>
            }
            emailCodeLoginEnabled={emailCodeLoginEnabled}
            onMethodChange={(method) => {
              setPreferredLoginMethod(method)
              setFeedback(null)
            }}
            passwordContent={
              <YStack gap="$4">
                <AppInput
                  accessibilityLabel="账号"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  bg="$color1"
                  color="$gray12"
                  disabled={isCredentialsLoading || isPending}
                  id={ACCOUNT_INPUT_ID}
                  keyboardType="email-address"
                  onChangeText={handleAccountChange}
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  placeholder="输入邮箱"
                  placeholderTextColor="$gray9"
                  ref={accountInputRef}
                  returnKeyType="next"
                  spellCheck={false}
                  value={account}
                />

                <PasswordInput
                  accessibilityLabel="密码"
                  autoCapitalize="none"
                  autoComplete="password"
                  bg="$color1"
                  color="$gray12"
                  disabled={isCredentialsLoading || isPending}
                  id={PASSWORD_INPUT_ID}
                  onChangeText={handlePasswordChange}
                  onSubmitEditing={() => void handleSignIn("password")}
                  placeholder="输入密码"
                  placeholderTextColor="$gray9"
                  ref={passwordInputRef}
                  returnKeyType="done"
                  value={password}
                />

                <LoginButton
                  disabled={isSignInDisabled}
                  isLoading={passwordLoginMutation.isPending}
                  onPress={() => void handleSignIn("password")}
                  testID="password-login-submit-button"
                />
              </YStack>
            }
            passwordLoginEnabled={passwordLoginEnabled}
          />
        </YStack>
      </Card>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setFeedback(null)
        }}
        open={visibleFeedback !== null}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay bg="$shadow6" opacity={0.5} />
          <AlertDialog.Content bordered elevate gap="$4" maxW={440} width="90%">
            <AlertDialog.Title fontSize="$5" lineHeight="$6">
              {visibleFeedback?.title ?? "操作失败"}
            </AlertDialog.Title>
            <AlertDialog.Description>
              {visibleFeedback?.message}
            </AlertDialog.Description>
            <XStack gap="$3" width="100%">
              <AlertDialog.Action asChild>
                <Button grow={1} theme="teal">
                  知道了
                </Button>
              </AlertDialog.Action>
            </XStack>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog>
    </>
  )
}

function LoginButton({
  disabled,
  isLoading,
  onPress,
  testID,
}: {
  disabled: boolean
  isLoading: boolean
  onPress: () => void
  testID: string
}) {
  return (
    <AppButton
      accessibilityLabel="登录"
      disabled={disabled}
      disabledStyle={{ opacity: 0.5 }}
      icon={isLoading ? <Spinner /> : undefined}
      onPress={onPress}
      size="$4"
      testID={testID}
      theme="accent"
      width="100%"
    >
      {isLoading ? "登录中…" : "登录"}
    </AppButton>
  )
}
