import { useRouter, type Href } from "expo-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { ScrollView } from "react-native"
import { Paragraph, XStack, YStack } from "tamagui"

import { AppAvatar } from "@/components/avatar/app-avatar"
import { ContentState } from "@/components/feedback/content-state"
import { AppHeader } from "@/components/navigation/app-header"
import { ApiRequestError } from "@/data/api-client"
import { accountLoginHref, AccountActionSingleFlight, addAccountServerHref, buildAccountListItems, performAccountLogout, performAccountSwitch } from "@/features/accounts/account-management-model"
import { useAuth } from "@/providers/auth-provider"
import { useClientSession } from "@/providers/client-data-provider"
import { useServers } from "@/providers/server-provider"
import { XGUIActionSheet, XGUIButton, XGUIList, XGUIListItem, useXGUITheme, useXGUIToast } from "@/xgui"

export function AccountManagementScreen() {
  const router = useRouter()
  const toast = useXGUIToast()
  const { colors } = useXGUITheme()
  const { addServer, servers, selectServer } = useServers()
  const { currentUser } = useClientSession()
  const { accounts, active, isHydrated, phase, refreshMissingAccountProfiles, signOutAccount, switchAccount } = useAuth()
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [actionError, setActionError] = useState("")
  const [logoutAccountId, setLogoutAccountId] = useState<string | null>(null)
  const flight = useRef(new AccountActionSingleFlight())
  const [logoutAvatarSnapshot, setLogoutAvatarSnapshot] = useState<{ accountId: string; avatar: string } | null>(null)
  const retryActionRef = useRef<(() => void) | null>(null)
  const items = useMemo(() => buildAccountListItems(accounts, active?.accountId ?? null), [accounts, active?.accountId])
  const [switchItemsSnapshot, setSwitchItemsSnapshot] = useState<typeof items | null>(null)
  const [completedSwitchAccountId, setCompletedSwitchAccountId] = useState<string | null>(null)
  const displayedItems = switchItemsSnapshot ?? items
  const logoutItem = displayedItems.find((item) => item.accountId === logoutAccountId)
  const globallyBusy = phase === "preparing"

  useEffect(() => {
    if (!isHydrated || !accounts.some((account) => !account.avatar && account.status === "ready")) return
    void refreshMissingAccountProfiles().catch(() => undefined)
  }, [accounts, isHydrated, refreshMissingAccountProfiles])

  useEffect(() => {
    if (!completedSwitchAccountId || active?.accountId !== completedSwitchAccountId || phase !== "authenticated") return
    toast.hide()
    let secondFrame: number | null = null
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => router.dismissTo("/messages"))
    })
    return () => {
      cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) cancelAnimationFrame(secondFrame)
    }
  }, [active?.accountId, completedSwitchAccountId, phase, router, toast])

  async function runAccountAction(accountId: string, operation: () => Promise<void>, presentation: "inline" | "logout-toast" | "switch-toast" = "inline") {
    if (presentation === "inline") retryActionRef.current = () => { void runAccountAction(accountId, operation).catch(() => undefined) }
    const result = await flight.current.run(accountId, async () => {
      if (presentation === "logout-toast") toast.show({ duration: 0, message: "正在登出账号", type: "loading" })
      else if (presentation === "switch-toast") toast.show({ duration: 0, message: "正在切换账号", modal: true, type: "loading" })
      else { setBusyAccountId(accountId); setActionError("") }
      let failed = false
      try { await operation() }
      catch (error) {
        failed = true
        const message = error instanceof ApiRequestError || error instanceof Error ? error.message : "账号操作失败，请稍后重试"
        if (presentation === "inline") setActionError(message)
        toast.show({ message, modal: false, type: "error" })
        throw error
      } finally {
        if (presentation === "logout-toast" && !failed) toast.hide()
        if (presentation === "inline") setBusyAccountId(null)
      }
    })
    return result
  }

  function openLogin(accountId: string) {
    const item = displayedItems.find((candidate) => candidate.accountId === accountId)
    if (!item) return
    const existingServer = servers.find((server) => server.id === item.target.id || server.url === item.target.url)
    if (existingServer) selectServer(existingServer.id)
    else {
      const added = addServer(item.target.url, item.target.url)
      if (added.status !== "added") {
        toast.show({ message: "无法恢复账号服务器，请先在服务器管理中添加", modal: false, type: "error" })
        return
      }
      selectServer(added.server.id)
    }
    router.push(accountLoginHref(accountId) as Href)
  }

  function handleAccountPress(accountId: string) {
    const item = displayedItems.find((candidate) => candidate.accountId === accountId)
    if (!item || globallyBusy || busyAccountId) return
    if (item.status === "reauth-required") { openLogin(accountId); return }
    if (item.isCurrent) return
    setSwitchItemsSnapshot(items)
    setCompletedSwitchAccountId(null)
    void runAccountAction(accountId, async () => {
      await performAccountSwitch({ accountId, currentAccountId: active?.accountId ?? null,
        switchAccount, navigate: () => setCompletedSwitchAccountId(accountId) })
    }, "switch-toast").catch(() => setSwitchItemsSnapshot(null))
  }

  function confirmLogout() {
    const accountId = logoutAccountId
    setLogoutAccountId(null)
    if (!accountId) return
    if (active?.accountId && currentUser?.avatar) setLogoutAvatarSnapshot({ accountId: active.accountId, avatar: currentUser.avatar })
    void runAccountAction(accountId, async () => {
      await performAccountLogout({ accountId, signOutAccount, navigate: () => {
        const remaining = accounts.filter((account) => account.id !== accountId)
        router.replace((remaining.length ? "/account-management" : "/login") as Href)
      } })
    }, "logout-toast").catch(() => undefined).finally(() => setLogoutAvatarSnapshot(null))
  }

  if (!isHydrated) return <ContentState loading message="正在加载账号" />

  return (
    <YStack bg={colors.background0} flex={1}>
      <AppHeader onBackPress={() => router.back()} title="账号管理" />
      {actionError ? (
        <YStack gap="$2" px="$4" py="$2">
          <Paragraph accessibilityLiveRegion="polite" color={colors.destructive}>{actionError}</Paragraph>
          <XGUIButton accessibilityLabel="重试账号操作" disabled={globallyBusy || busyAccountId !== null} onPress={() => retryActionRef.current?.()} size="mini" variant="secondary">重试</XGUIButton>
        </YStack>
      ) : null}
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}>
        <YStack maxW={440} self="center" width="100%">
          {displayedItems.length ? (
            <YStack px="$4">
              <XGUIList variant="form-radio">
                {displayedItems.map((item, index) => {
                  const loadedAvatar = item.isCurrent ? currentUser?.avatar : ""
                  const logoutAvatar = logoutAvatarSnapshot?.accountId === item.accountId ? logoutAvatarSnapshot.avatar : ""
                  const avatar = item.avatar || loadedAvatar || logoutAvatar
                  const disabled = globallyBusy || busyAccountId !== null
                  return (
                    <XGUIListItem
                      accessibilityLabel={item.accessibilityLabel}
                      description={item.target.url}
                      disabled={disabled}
                      key={item.accountId}
                      leading={<AppAvatar accessibilityLabel={`${item.name}头像`} avatar={avatar} server={item.target} size={44} type="user" />}
                      minHeight={72}
                      onPress={() => handleAccountPress(item.accountId)}
                      separator={index > 0}
                      title={item.email}
                      trailing={(
                        <XStack gap="$2">
                          <XGUIButton
                            accessibilityLabel={item.isCurrent ? `当前账号${item.email}` : `切换到账号${item.email}`}
                            accessibilityState={{ busy: busyAccountId === item.accountId, disabled: disabled || item.isCurrent }}
                            disabled={disabled || item.isCurrent}
                            loading={!item.isCurrent && busyAccountId === item.accountId}
                            hitSlop={{ bottom: 8, left: 4, right: 4, top: 8 }}
                            onPress={() => handleAccountPress(item.accountId)}
                            size="xmini"
                            style={{ minHeight: 28, paddingHorizontal: 8 }}
                            textStyle={{ fontSize: 12, lineHeight: 16 }}
                          >
                            {item.isCurrent ? "当前" : "切换"}
                          </XGUIButton>
                          <XGUIButton
                            accessibilityLabel={`登出账号${item.email}`}
                            accessibilityState={{ busy: busyAccountId === item.accountId, disabled }}
                            disabled={disabled}
                            loading={busyAccountId === item.accountId}
                            hitSlop={{ bottom: 8, left: 4, right: 4, top: 8 }}
                            onPress={() => setLogoutAccountId(item.accountId)}
                            size="xmini"
                            style={{ minHeight: 28, paddingHorizontal: 8 }}
                            textStyle={{ fontSize: 12, lineHeight: 16 }}
                            variant="danger"
                          >
                            登出
                          </XGUIButton>
                        </XStack>
                      )}
                    />
                  )
                })}
              </XGUIList>
            </YStack>
          ) : (
            <ContentState message="本机还没有账号" />
          )}
          <YStack p="$4">
            <XGUIButton accessibilityLabel="添加账号" disabled={globallyBusy || busyAccountId !== null} onPress={() => router.push(addAccountServerHref() as Href)} variant="secondary">
              添加账号
            </XGUIButton>
          </YStack>
        </YStack>
      </ScrollView>
      <XGUIActionSheet
        actions={logoutItem ? [{ accessibilityLabel: `确认登出账号${logoutItem.email}`, destructive: true, label: "登出", onPress: confirmLogout }] : []}
        description={logoutItem ? `确定登出“${logoutItem.email}”吗？网络失败时账号会保留在本机。` : undefined}
        onOpenChange={(open) => { if (!open) setLogoutAccountId(null) }}
        open={Boolean(logoutItem)}
        title="登出账号"
      />
    </YStack>
  )
}
