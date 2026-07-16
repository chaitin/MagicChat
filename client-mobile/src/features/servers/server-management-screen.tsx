import { useRouter } from "expo-router"
import { Plus } from "lucide-react-native"
import { useRef, useState } from "react"
import { ScrollView, StyleSheet } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  AlertDialog,
  Card,
  XStack,
  YStack,
} from "tamagui"

import { AppButton } from "@/components/forms/app-button"
import { ThemedIcon } from "@/components/icons/themed-icon"
import { PageHeader } from "@/components/navigation/page-header"
import { useAuth } from "@/features/auth/auth-context"
import { AddServerDialog } from "@/features/servers/add-server-dialog"
import { useServers } from "@/features/servers/server-context"
import { ServerListItem } from "@/features/servers/server-list-item"
import type { ServerConfig } from "@/features/servers/server-model"

export function ServerManagementScreen() {
  const router = useRouter()
  const { invalidateSession, session } = useAuth()
  const { removeServer, selectedServer, selectServer, servers } = useServers()
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<ServerConfig | null>(null)
  const closeOpenSwipeableRef = useRef<(() => void) | null>(null)

  function closeOpenSwipeable() {
    closeOpenSwipeableRef.current?.()
    closeOpenSwipeableRef.current = null
  }

  function handleSwipeableOpen(close: () => void) {
    if (closeOpenSwipeableRef.current !== close) {
      closeOpenSwipeableRef.current?.()
      closeOpenSwipeableRef.current = close
    }
  }

  function handleSwipeableClose(close: () => void) {
    if (closeOpenSwipeableRef.current === close) {
      closeOpenSwipeableRef.current = null
    }
  }

  function handleOpenAddDialog() {
    closeOpenSwipeable()
    setIsAddDialogOpen(true)
  }

  function handleRequestDelete(server: ServerConfig) {
    closeOpenSwipeable()
    setServerToDelete(server)
  }

  function returnToLogin() {
    if (router.canGoBack()) {
      router.back()
      return
    }

    router.replace("/login")
  }

  async function handleSelect(server: ServerConfig) {
    closeOpenSwipeable()
    await invalidateSession()
    selectServer(server.id)
    router.replace("/init")
  }

  async function handleDelete() {
    if (!serverToDelete) {
      return
    }

    const deletesSessionServer = session?.id === serverToDelete.id
    if (deletesSessionServer) {
      await invalidateSession()
    }

    removeServer(serverToDelete.id)
    setServerToDelete(null)

    if (deletesSessionServer) {
      router.replace("/init")
    }
  }

  return (
    <YStack bg="$background" flex={1}>
      <PageHeader
        actionIcon={<ThemedIcon icon={Plus} size={22} />}
        actionLabel="添加服务器"
        compactTitle
        onActionPress={handleOpenAddDialog}
        onBackPress={returnToLogin}
        subtleButtonPress
        title="服务器管理"
      />

      <SafeAreaView edges={["bottom"]} style={styles.fill}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <YStack
            grow={1}
            items="center"
            onPress={closeOpenSwipeable}
            px="$4"
            py="$4"
          >
            <Card maxW={440} size="$5" width="100%">
              <YStack gap="$3" p="$3">
                <YStack gap="$3">
                  {servers.map((server) => (
                    <ServerListItem
                      isSelected={server.id === selectedServer.id}
                      key={server.id}
                      onDelete={() => handleRequestDelete(server)}
                      onSelect={() => void handleSelect(server)}
                      onSwipeableClose={handleSwipeableClose}
                      onSwipeableOpen={handleSwipeableOpen}
                      server={server}
                    />
                  ))}
                </YStack>

              </YStack>
            </Card>
          </YStack>
        </ScrollView>
      </SafeAreaView>

      <AddServerDialog
        onOpenChange={setIsAddDialogOpen}
        open={isAddDialogOpen}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setServerToDelete(null)
          }
        }}
        open={serverToDelete !== null}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay bg="$shadow6" opacity={0.5} />
          <AlertDialog.Content bordered elevate gap="$4" maxW={440} width="90%">
            <AlertDialog.Title fontSize="$5" lineHeight="$6">
              删除服务器
            </AlertDialog.Title>
            <AlertDialog.Description color="$gray9">
              确定删除“{serverToDelete?.name}”吗？此操作无法撤销。
            </AlertDialog.Description>
            <XStack gap="$3" width="100%">
              <AppButton
                accessibilityLabel="取消删除服务器"
                grow={1}
                onPress={() => setServerToDelete(null)}
                theme="gray"
              >
                取消
              </AppButton>
              <AppButton
                accessibilityLabel="确认删除服务器"
                grow={1}
                onPress={() => void handleDelete()}
                theme="red"
              >
                删除
              </AppButton>
            </XStack>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog>
    </YStack>
  )
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
})
