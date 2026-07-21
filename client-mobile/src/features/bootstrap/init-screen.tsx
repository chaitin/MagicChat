import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { useEffect, useState } from "react"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  Button,
  H4,
  Image,
  Paragraph,
  Spinner,
  Theme,
  XStack,
  YStack,
} from "tamagui"

import { ApiRequestError, isUnauthorizedError } from "@/data/api-client"
import { fetchCurrentUser } from "@/data/current-user-api"
import {
  appInfoQueryOptions,
  contactsQueryOptions,
  conversationsQueryOptions,
  queryKeys,
} from "@/data/query"
import { clearAuthenticatedServerData } from "@/data/session-cache"
import { useAuth } from "@/features/auth/auth-context"
import { useServers } from "@/features/servers/server-context"

const MINIMUM_LOADING_TIME_MS = 2_000

type InitState =
  | { status: "loading" }
  | { message: string; status: "error" }

export function InitScreen() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { invalidateSession, signIn } = useAuth()
  const { isHydrated, selectedServer } = useServers()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<InitState>({ status: "loading" })

  useEffect(() => {
    if (!isHydrated) {
      return
    }

    let isActive = true
    const controller = new AbortController()
    const minimumLoading = wait(MINIMUM_LOADING_TIME_MS)
    const server = {
      id: selectedServer.id,
      url: selectedServer.url,
    }

    async function initialize() {
      await Promise.resolve()

      if (!isActive) {
        return
      }

      setState({ status: "loading" })

      try {
        await invalidateSession()
        await clearAuthenticatedServerData(queryClient, server)

        queryClient.removeQueries({
          exact: true,
          queryKey: queryKeys.appInfo(server),
        })

        const appInfo = await queryClient.fetchQuery(
          appInfoQueryOptions(server)
        )

        if (!appInfo.authenticated) {
          await minimumLoading

          if (isActive) {
            router.replace("/login")
          }
          return
        }

        const currentUser = await fetchCurrentUser(server.url, {
          signal: controller.signal,
        })

        if (!isActive) {
          return
        }
        const authenticatedTarget = {
          ...server,
          userId: currentUser.id,
        }

        queryClient.setQueryData(
          queryKeys.currentUser(authenticatedTarget),
          currentUser
        )

        await Promise.all([
          queryClient.fetchQuery(contactsQueryOptions(authenticatedTarget)),
          queryClient.fetchQuery(conversationsQueryOptions(authenticatedTarget)),
          minimumLoading,
        ])

        if (isActive) {
          signIn(authenticatedTarget)
          router.replace("/messages")
        }
      } catch (error: unknown) {
        await minimumLoading

        if (!isActive) {
          return
        }

        if (isUnauthorizedError(error)) {
          router.replace("/login")
          return
        }

        setState({
          message:
            error instanceof ApiRequestError
              ? error.message
              : "加载工作区失败",
          status: "error",
        })
      }
    }

    void initialize()

    return () => {
      isActive = false
      controller.abort()
    }
  }, [
    attempt,
    isHydrated,
    queryClient,
    router,
    selectedServer.id,
    selectedServer.url,
    invalidateSession,
    signIn,
  ])

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <YStack
        bg="$background"
        flex={1}
        gap="$5"
        items="center"
        justify="center"
        p="$6"
      >
        <Image
          alt="即应 Logo"
          borderRadius={16}
          height="$8"
          src={require("../../../assets/images/icon.png")}
          width="$8"
        />

        {state.status === "loading" ? (
          <XStack gap="$2" items="center">
            <Spinner size="small" />
            <Paragraph color="$color10" text="center">
              正在连接 {selectedServer.name}
            </Paragraph>
          </XStack>
        ) : (
          <YStack gap="$4" items="center" maxW={360} width="100%">
            <H4 text="center">数据加载失败</H4>
            <Theme name="red">
              <Paragraph color="$color10" text="center">
                {state.message}
              </Paragraph>
            </Theme>
            <Button
              onPress={() => {
                setState({ status: "loading" })
                setAttempt((current) => current + 1)
              }}
              theme="teal"
              width="100%"
            >
              重试
            </Button>
            <Button
              onPress={() => router.push("/server-management")}
              variant="outlined"
              width="100%"
            >
              服务器管理
            </Button>
          </YStack>
        )}
      </YStack>
    </SafeAreaView>
  )
}

function wait(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs)
  })
}
