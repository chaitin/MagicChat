import { useQueryClient } from "@tanstack/react-query"
import { Redirect, type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import { ChevronLeft } from "lucide-react-native"
import { useCallback, useEffect, useMemo, useState } from "react"
import { BackHandler } from "react-native"
import { Image, Paragraph, XStack, YStack } from "tamagui"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { ContentState } from "@/components/feedback/content-state"
import { PageHeader } from "@/components/navigation/page-header"
import { useAppInfoQuery } from "@/data/auth/auth-hooks"
import { queryKeys } from "@/data/query"
import { LoginForm } from "@/features/auth/login-form"
import { isAccountLoginMode, resolveLoginTarget, shouldRedirectAuthenticatedLogin } from "@/features/accounts/account-management-model"
import { useAuth } from "@/providers/auth-provider"
import { useServers } from "@/providers/server-provider"
import { useXGUITheme, useXGUIToast } from "@/xgui"

const CONNECTION_TIMEOUT_MS = 5_000
const MIN_CONNECTION_TOAST_MS = 300

export function LoginScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ accountId?: string; mode?: string; returnTo?: string }>()
  const accountFlow = isAccountLoginMode(params.mode)
  const queryClient = useQueryClient()
  const {
    accounts,
    isAuthenticated,
    isHydrated: authHydrated,
    isPreparingSignIn,
  } = useAuth()
  const {
    isHydrated: serversHydrated,
    markServerAsRecentlyUsed,
    selectedServer,
  } = useServers()
  const { colors } = useXGUITheme()
  const { hide: hideToast, show: showToast } = useXGUIToast()
  const resolvedLogin = useMemo(() => resolveLoginTarget({ accounts, accountId: params.accountId, authHydrated, mode: params.mode, selectedServer }),
    [accounts, authHydrated, params.accountId, params.mode, selectedServer])
  const loginServer = resolvedLogin.target
  const reauthAccount = resolvedLogin.account
  const routeDependenciesReady = serversHydrated && !resolvedLogin.pendingReauth
  const appInfoQuery = useAppInfoQuery(loginServer, routeDependenciesReady && !resolvedLogin.invalidReauth)
  const serverKey = `${loginServer.id}\u0000${loginServer.url}`
  const [timedOutServerKey, setTimedOutServerKey] = useState<string | null>(
    null
  )
  const connectionTimedOut = timedOutServerKey === serverKey
  useEffect(() => {
    if (!resolvedLogin.invalidReauth) return
    showToast({ message: "账号不存在或已被移除", modal: false, type: "error" })
  }, [resolvedLogin.invalidReauth, showToast])
  const connectionLoading =
    routeDependenciesReady && appInfoQuery.isFetching && !connectionTimedOut
  const returnToServerSelection = useCallback(() => {
    if (isPreparingSignIn) return

    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace((accountFlow ? "/account-management" : "/server-management") as Href)
  }, [accountFlow, isPreparingSignIn, router])

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          returnToServerSelection()
          return true
        }
      )
      return () => subscription.remove()
    }, [returnToServerSelection])
  )

  useEffect(() => {
    if (isPreparingSignIn || !connectionLoading) return

    const timeout = setTimeout(() => {
      setTimedOutServerKey(serverKey)
      hideToast()
      void queryClient.cancelQueries({
        exact: true,
        queryKey: queryKeys.appInfo(loginServer),
      })
    }, CONNECTION_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [
    connectionLoading,
    hideToast,
    isPreparingSignIn,
    queryClient,
    loginServer,
    serverKey,
  ])

  useEffect(() => {
    if (isPreparingSignIn) return

    if (!connectionLoading) {
      hideToast()
      return
    }

    showToast({
      duration: 0,
      message: "正在连接服务器",
      type: "loading",
    })
    return hideToast
  }, [
    connectionLoading,
    hideToast,
    isPreparingSignIn,
    serverKey,
    showToast,
  ])

  if (!routeDependenciesReady) return <ContentState loading message="正在加载登录信息" />

  if (resolvedLogin.invalidReauth) return <Redirect href={"/account-management" as Href} />

  if (shouldRedirectAuthenticatedLogin(isAuthenticated, params.mode)) {
    return <Redirect href="/messages" />
  }

  const appInfo = appInfoQuery.data
  const connectionReady =
    Boolean(appInfo) &&
    !appInfoQuery.isError &&
    !appInfoQuery.isFetching &&
    !connectionTimedOut
  const connectionFailed = appInfoQuery.isError || connectionTimedOut

  async function handleRetryConnection() {
    const toastStartedAt = Date.now()
    setTimedOutServerKey(null)
    showToast({
      duration: 0,
      message: "正在连接服务器",
      type: "loading",
    })

    try {
      await queryClient.cancelQueries({
        exact: true,
        queryKey: queryKeys.appInfo(loginServer),
      })
      await appInfoQuery.refetch()
    } finally {
      const remainingToastMs =
        MIN_CONNECTION_TOAST_MS - (Date.now() - toastStartedAt)
      if (remainingToastMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingToastMs))
      }
      hideToast()
    }
  }

  function handleLoginSuccess() {
    markServerAsRecentlyUsed(loginServer.id)
    hideToast()
    router.replace("/messages")
    return Promise.resolve()
  }

  return (
    <YStack bg={colors.background0} flex={1}>
      <PageHeader
        backDisabled={isPreparingSignIn}
        backIcon={ChevronLeft}
        backIconColor={colors.textPrimary}
        background={colors.background0}
        compactIconButtons
        onBackPress={returnToServerSelection}
        title=""
      />
      <KeyboardAwareScreen
        contentBackground={colors.background0}
        edges={["left", "right", "bottom"]}
        keyboardShouldPersistTaps="always"
        items="center"
        pb={128}
        pt="$2"
        px="$4"
      >
      <YStack grow={1} maxW={440} width="100%">
        <YStack gap={48} grow={1} justify="center">
          <XStack gap="$3" items="center" justify="center">
            <Image
              alt="即应 Logo"
              borderRadius={10}
              height="$5"
              src={require("../../../assets/images/icon.png")}
              width="$5"
            />
            {appInfo ? (
              <YStack gap="$1.5" shrink={1}>
                <Paragraph fontSize="$5" fontWeight="600" lineHeight="$6">
                  {appInfo.appName} 智能协作平台
                </Paragraph>
                <Paragraph color="$color10" fontSize="$3">
                  {appInfo.organizationName} 的工作空间
                </Paragraph>
              </YStack>
            ) : null}
          </XStack>

          <LoginForm
            connectionFailed={connectionFailed}
            connectionReady={connectionReady}
            emailCodeLoginEnabled={appInfo?.emailCodeLoginEnabled ?? true}
            assistanceAccountId={reauthAccount?.id}
            initialAccount={reauthAccount?.email}
            onLoginSuccess={handleLoginSuccess}
            onRetryConnection={() => void handleRetryConnection()}
            passwordLoginEnabled={appInfo?.passwordLoginEnabled ?? true}
            server={loginServer}
          />
        </YStack>
      </YStack>
      </KeyboardAwareScreen>
    </YStack>
  )
}
