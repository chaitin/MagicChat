import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import * as ImagePicker from "expo-image-picker"
import { useRouter, type Href } from "expo-router"
import { StyleSheet, View } from "react-native"
import { XStack, YStack } from "tamagui"

import { AppAvatar } from "@/components/avatar/app-avatar"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { AppHeader } from "@/components/navigation/app-header"
import { queryKeys } from "@/data/query"
import { contactManager } from "@/data/contacts"
import { prepareAvatar } from "@/data/users/avatar-image"
import { uploadCurrentUserAvatar } from "@/data/users/current-user-api"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { useClientSession } from "@/providers/client-data-provider"
import {
  type MediaPermissionKind,
  requestPermissionForUserAction,
} from "@/features/permissions/media-permission"
import { MediaPermissionSettingsDialog } from "@/components/permissions/media-permission-settings-dialog"
import {
  XGUIActionSheet,
  XGUILoadingIcon,
  XGUIList,
  XGUIListItem,
  useXGUITheme,
  useXGUIToast,
} from "@/xgui"

export function ProfileScreen() {
  const router = useRouter()
  const session = useAuthenticatedSession()
  const { currentUser } = useClientSession()
  const queryClient = useQueryClient()
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const [savingAvatar, setSavingAvatar] = useState(false)
  const [avatarSheetOpen, setAvatarSheetOpen] = useState(false)
  const [deactivationSheetOpen, setDeactivationSheetOpen] = useState(false)
  const [permissionSettingsRequired, setPermissionSettingsRequired] =
    useState<MediaPermissionKind | null>(null)
  const displayName =
    currentUser?.nickname.trim() ||
    currentUser?.name.trim() ||
    currentUser?.email ||
    "当前账号"

  async function refreshProfileQueries() {
    await Promise.allSettled([
      queryClient.invalidateQueries({ queryKey: queryKeys.currentUser(session) }),
      contactManager.refreshUsers(session, [session.userId]),
      queryClient.invalidateQueries({ queryKey: queryKeys.conversations(session) }),
    ])
  }

  async function chooseAvatar(source: "camera" | "library") {
    if (savingAvatar) return
    setAvatarSheetOpen(false)
    try {
      if (source === "camera") {
        const permission = await requestPermissionForUserAction(
          ImagePicker.getCameraPermissionsAsync,
          ImagePicker.requestCameraPermissionsAsync
        )
        if (permission === "denied") return
        if (permission === "settings") {
          setPermissionSettingsRequired("camera")
          return
        }
      }

      const options: ImagePicker.ImagePickerOptions = {
        allowsEditing: true,
        aspect: [1, 1],
        mediaTypes: ["images"],
        quality: 1,
      }
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(options)
          : await ImagePicker.launchImageLibraryAsync(options)
      if (result.canceled) return

      const asset = result.assets[0]
      if (asset) await saveAvatar(asset)
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "修改头像失败，请稍后重试",
        modal: false,
        type: "error",
      })
    }
  }

  async function saveAvatar(source: Parameters<typeof prepareAvatar>[0]) {
    if (savingAvatar) return
    setSavingAvatar(true)
    try {
      const prepared = await prepareAvatar(source)
      try {
        await uploadCurrentUserAvatar(session, prepared.uri)
        await refreshProfileQueries()
        toast.show({ message: "头像已更新", modal: false, type: "success" })
      } finally { prepared.cleanup() }
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : "修改头像失败，请稍后重试", modal: false, type: "error" })
    } finally { setSavingAvatar(false) }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background0 }]}>
      <AppHeader onBackPress={router.back} title="个人信息" />
      <KeyboardAwareScreen contentBackground={colors.background0} edges={[]}>
        <YStack maxW={440} self="center" width="100%">
          <XGUIList size="large">
            <XGUIListItem
              disabled={savingAvatar}
              minHeight={96}
              onPress={() => setAvatarSheetOpen(true)}
              title="头像"
              trailing={
                <XStack gap="$3" items="center">
                  <AppAvatar accessibilityLabel={displayName} avatar={currentUser?.avatar} server={session} size="$7" type="user" />
                  {savingAvatar ? (
                    <XGUILoadingIcon color={colors.textPlaceholder} size={20} />
                  ) : null}
                </XStack>
              }
            />
          </XGUIList>
          <XGUIList size="large">
            <XGUIListItem
              onPress={() => router.push("/profile-nickname" as Href)}
              title="昵称"
              value={currentUser?.nickname.trim() || "未设置"}
              valuePlaceholder={!currentUser?.nickname.trim()}
            />
            <XGUIListItem
              separator
              title="姓名"
              value={currentUser?.name.trim() || "未设置"}
              valuePlaceholder={!currentUser?.name.trim()}
            />
            <XGUIListItem
              separator
              title="邮箱"
              value={currentUser?.email.trim() || "未设置"}
              valuePlaceholder={!currentUser?.email.trim()}
            />
            <XGUIListItem
              separator
              title="手机"
              value={currentUser?.phone.trim() || "未设置"}
              valuePlaceholder={!currentUser?.phone.trim()}
            />
          </XGUIList>
          <XGUIList size="large">
            <XGUIListItem centerContent destructive onPress={() => setDeactivationSheetOpen(true)} title="注销账号" />
          </XGUIList>
        </YStack>
      </KeyboardAwareScreen>

      <MediaPermissionSettingsDialog
        kind={permissionSettingsRequired}
        onCancel={() => setPermissionSettingsRequired(null)}
      />
      <XGUIActionSheet
        actions={[
          {
            deferUntilClosed: true,
            disabled: savingAvatar,
            label: "拍照",
            onPress: () => void chooseAvatar("camera"),
          },
          {
            deferUntilClosed: true,
            disabled: savingAvatar,
            label: "从相册选择",
            onPress: () => void chooseAvatar("library"),
          },
        ]}
        onOpenChange={setAvatarSheetOpen}
        open={avatarSheetOpen}
        title="修改头像"
      />
      <XGUIActionSheet
        actions={[{ deferUntilClosed: true, destructive: true, label: "继续注销", onPress: () => router.push("/account-deactivation" as Href) }]}
        description="注销后账号将无法登录，无法自行恢复；如需恢复请联系管理员。"
        onOpenChange={setDeactivationSheetOpen}
        open={deactivationSheetOpen}
        title="注销账号"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
})
