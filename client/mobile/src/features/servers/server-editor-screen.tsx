import { Redirect, useLocalSearchParams, useRouter } from "expo-router"
import { ChevronLeft } from "lucide-react-native"
import { useRef, useState } from "react"
import type { TextInput } from "react-native"
import { YStack } from "tamagui"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { PageHeader } from "@/components/navigation/page-header"
import type { ServerConfig } from "@/core/server-model"
import { isValidServerUrl } from "@/core/server-model"
import { useAuth } from "@/providers/auth-provider"
import { useServers } from "@/providers/server-provider"
import {
  XGUIInformationBar,
  XGUIInput,
  useXGUITheme,
} from "@/xgui"

export function ServerEditorScreen() {
  const { serverId: serverIdParam } = useLocalSearchParams<{
    serverId?: string | string[]
  }>()
  const { isHydrated, servers } = useServers()
  const serverId = Array.isArray(serverIdParam)
    ? serverIdParam[0]
    : serverIdParam
  const server = serverId
    ? servers.find((candidate) => candidate.id === serverId)
    : null

  if (!isHydrated) return null
  if (serverId && (!server || server.isBuiltIn)) {
    return <Redirect href="/server-management" />
  }

  return <ServerEditorForm server={server ?? null} />
}

function ServerEditorForm({ server }: { server: ServerConfig | null }) {
  const router = useRouter()
  const { invalidateSession, session } = useAuth()
  const { addServer, updateServer } = useServers()
  const { colors } = useXGUITheme()
  const addressInputRef = useRef<TextInput>(null)
  const isSavingRef = useRef(false)
  const [name, setName] = useState(server?.name ?? "")
  const [url, setUrl] = useState(server?.url ?? "")
  const [errorMessage, setErrorMessage] = useState("")
  const isEditing = server !== null
  const saveDisabled = name.trim().length === 0 || url.trim().length === 0

  function returnToServerList() {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace("/server-management")
  }

  async function handleSave() {
    if (isSavingRef.current) return
    isSavingRef.current = true
    let didSave = false

    try {
      if (!name.trim() || !isValidServerUrl(url)) {
        setErrorMessage("请填写服务器名称和有效的 HTTPS 地址")
        return
      }

      const result = server
        ? updateServer(server.id, name, url)
        : addServer(name, url)

      if (result.status === "duplicate") {
        setErrorMessage("该服务器地址已经存在")
        return
      }

      if (result.status === "invalid") {
        setErrorMessage("请填写服务器名称和有效的 HTTPS 地址")
        return
      }

      if (result.status === "not-found") {
        setErrorMessage("该服务器已不存在")
        return
      }

      if (!("server" in result)) return

      if (
        server &&
        session?.id === server.id &&
        server.url !== result.server.url
      ) {
        await invalidateSession()
      }
      didSave = true
      returnToServerList()
    } finally {
      if (!didSave) isSavingRef.current = false
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
        onBackPress={returnToServerList}
        primaryAction
        subtleButtonPress={false}
        title={isEditing ? "修改服务器" : "添加服务器"}
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
          <YStack overflow="hidden" style={{ borderRadius: 8 }}>
            <XGUIInput
              autoCapitalize="none"
              label="名称"
              onChangeText={(value) => {
                setName(value)
                setErrorMessage("")
              }}
              onSubmitEditing={() => addressInputRef.current?.focus()}
              placeholder="服务器名称"
              returnKeyType="next"
              separator
              value={name}
            />
            <XGUIInput
              autoCapitalize="none"
              autoComplete="url"
              autoCorrect={false}
              keyboardType="url"
              label="地址"
              onChangeText={(value) => {
                setUrl(value)
                setErrorMessage("")
              }}
              onSubmitEditing={() => void handleSave()}
              placeholder="https://example.com"
              ref={addressInputRef}
              returnKeyType="done"
              spellCheck={false}
              value={url}
            />
          </YStack>

          {errorMessage ? (
            <XGUIInformationBar
              floating={false}
              message={errorMessage}
              style={{ marginTop: 16 }}
              variant="warn-weak"
            />
          ) : null}
        </YStack>
      </KeyboardAwareScreen>
    </YStack>
  )
}
