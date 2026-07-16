import { Redirect, useRouter } from "expo-router"
import { useEffect, useRef, useState } from "react"
import { Linking, Pressable } from "react-native"
import {
  AlertDialog,
  Button,
  Card,
  Image,
  Paragraph,
  Spinner,
  type TamaguiElement,
  XStack,
  YStack,
} from "tamagui"

import { appConfig } from "@/config/app-config"
import { AppButton } from "@/components/forms/app-button"
import { AppInput } from "@/components/forms/app-input"
import { PasswordInput } from "@/components/forms/password-input"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { ApiRequestError } from "@/data/api-client"
import {
  loadLoginCredentials,
  saveLoginCredentials,
} from "@/data/auth-credential-store"
import { useCachedAppInfo, useLoginMutation } from "@/data/hooks"
import { useAuth } from "@/features/auth/auth-context"
import { SelectedServerButton } from "@/features/servers/selected-server-button"
import { useServers } from "@/features/servers/server-context"

const ACCOUNT_INPUT_ID = "login-account"
const PASSWORD_INPUT_ID = "login-password"
const COMPANY_WEBSITE_URL = "https://baizhi.cloud/"

type LoginFormState = {
  account: string
  isLoading: boolean
  password: string
  serverKey: string
}

export function LoginScreen() {
  const router = useRouter()
  const { isAuthenticated } = useAuth()
  const { isHydrated, selectedServer } = useServers()
  const appInfoQuery = useCachedAppInfo(selectedServer)
  const loginMutation = useLoginMutation(selectedServer)
  const accountInputRef = useRef<TamaguiElement>(null)
  const passwordInputRef = useRef<TamaguiElement>(null)
  const selectedServerKey = `${selectedServer.id}\n${selectedServer.url}`
  const [formState, setFormState] = useState<LoginFormState>({
    account: "",
    isLoading: true,
    password: "",
    serverKey: "",
  })
  const isCurrentServer = formState.serverKey === selectedServerKey
  const account = isCurrentServer ? formState.account : ""
  const password = isCurrentServer ? formState.password : ""
  const isCredentialsLoading = !isCurrentServer || formState.isLoading
  const [loginError, setLoginError] = useState<string | null>(null)
  const canSignIn =
    !isCredentialsLoading && account.trim().length > 0 && password.length > 0
  const isSignInDisabled = !canSignIn || loginMutation.isPending
  const appName = appInfoQuery.data?.appName ?? appConfig.name
  const organizationName =
    appInfoQuery.data?.organizationName ?? appConfig.organizationName

  useEffect(() => {
    let isCancelled = false

    void loadLoginCredentials({
      id: selectedServer.id,
      url: selectedServer.url,
    })
      .then((credentials) => {
        if (!isCancelled) {
          setFormState({
            account: credentials?.account ?? "",
            isLoading: false,
            password: credentials?.password ?? "",
            serverKey: selectedServerKey,
          })
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setFormState({
            account: "",
            isLoading: false,
            password: "",
            serverKey: selectedServerKey,
          })
        }
      })

    return () => {
      isCancelled = true
    }
  }, [selectedServer.id, selectedServer.url, selectedServerKey])

  function handleAccountChange(value: string) {
    setFormState((current) => ({
      account: value,
      isLoading: false,
      password:
        current.serverKey === selectedServerKey ? current.password : "",
      serverKey: selectedServerKey,
    }))
  }

  function handlePasswordChange(value: string) {
    setFormState((current) => ({
      account: current.serverKey === selectedServerKey ? current.account : "",
      isLoading: false,
      password: value,
      serverKey: selectedServerKey,
    }))
  }

  if (isAuthenticated) {
    return <Redirect href="/(app)/(tabs)/messages" />
  }

  if (!isHydrated || !appInfoQuery.data) {
    return <Redirect href="/init" />
  }

  async function handleSignIn() {
    if (!canSignIn || loginMutation.isPending) {
      return
    }

    setLoginError(null)

    try {
      await loginMutation.mutateAsync({ account, password })
      await saveLoginCredentials(selectedServer, { account, password }).catch(
        () => {
          // A successful login must not be blocked by local credential storage.
        }
      )
      router.replace("/init")
    } catch (error: unknown) {
      setLoginError(
        error instanceof ApiRequestError ? error.message : "登录失败"
      )
    }
  }

  return (
    <>
      <KeyboardAwareScreen
        items="center"
        pb="$5"
        pt="$3"
        px="$5"
      >
        <YStack grow={1} maxW={440} width="100%">
          <YStack grow={1} gap="$6" justify="center">
            <XStack gap="$3" items="center" justify="center">
              <Image
                alt={`${appName} Logo`}
                borderRadius={10}
                height="$5"
                src={require("../../../assets/images/icon.png")}
                width="$5"
              />
              <YStack gap="$2" shrink={1}>
                <Paragraph fontSize="$5" fontWeight="600" lineHeight="$6">
                  {appName} 智能协作平台
                </Paragraph>
                <Paragraph color="$color10" fontSize="$3">
                  {organizationName} 的工作空间
                </Paragraph>
              </YStack>
            </XStack>

            <Card size="$5">
              <YStack gap="$4" p="$4">
                <SelectedServerButton disabled={loginMutation.isPending} />

                <AppInput
                  accessibilityLabel="账号"
                  autoCapitalize="none"
                  autoComplete="email"
                  color="$gray12"
                  disabled={isCredentialsLoading || loginMutation.isPending}
                  id={ACCOUNT_INPUT_ID}
                  keyboardType="email-address"
                  onChangeText={handleAccountChange}
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  placeholder="输入邮箱"
                  placeholderTextColor="$gray9"
                  ref={accountInputRef}
                  returnKeyType="next"
                  value={account}
                />

                <PasswordInput
                  accessibilityLabel="密码"
                  autoCapitalize="none"
                  autoComplete="password"
                  color="$gray12"
                  disabled={isCredentialsLoading || loginMutation.isPending}
                  id={PASSWORD_INPUT_ID}
                  onChangeText={handlePasswordChange}
                  onSubmitEditing={() => void handleSignIn()}
                  placeholder="输入密码"
                  placeholderTextColor="$gray9"
                  ref={passwordInputRef}
                  returnKeyType="done"
                  value={password}
                />

                <AppButton
                  accessibilityLabel="登录"
                  disabled={isSignInDisabled}
                  disabledStyle={{ opacity: 0.5 }}
                  icon={loginMutation.isPending ? <Spinner /> : undefined}
                  onPress={() => void handleSignIn()}
                  size="$4"
                  testID="login-submit-button"
                  theme="accent"
                  width="100%"
                >
                  {loginMutation.isPending ? "登录中…" : "登录"}
                </AppButton>
              </YStack>
            </Card>
          </YStack>

          <XStack justify="center" mt="$4" width="100%">
            <Pressable
              accessibilityLabel="打开长亭科技官网"
              accessibilityRole="link"
              hitSlop={8}
              onPress={() => void Linking.openURL(COMPANY_WEBSITE_URL)}
            >
              {({ pressed }) => (
                <Paragraph
                  color="$color9"
                  fontSize="$2"
                  textDecorationLine={pressed ? "underline" : "none"}
                >
                  即应 - 长亭科技
                </Paragraph>
              )}
            </Pressable>
          </XStack>
        </YStack>
      </KeyboardAwareScreen>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setLoginError(null)
          }
        }}
        open={loginError !== null}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay bg="$shadow6" opacity={0.5} />
          <AlertDialog.Content bordered elevate gap="$4" maxW={440} width="90%">
            <AlertDialog.Title fontSize="$5" lineHeight="$6">
              登录失败
            </AlertDialog.Title>
            <AlertDialog.Description>{loginError}</AlertDialog.Description>
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
