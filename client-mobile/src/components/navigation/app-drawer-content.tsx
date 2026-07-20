import { useRouter, type Href } from "expo-router"
import { Bug, LogOut } from "lucide-react-native"
import { Alert } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  Avatar,
  Image,
  ListItem,
  Paragraph,
  SizableText,
  Spinner,
  Text,
  useTheme,
  XStack,
  YStack,
} from "tamagui"

import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import { AppButton } from "@/components/forms/app-button"
import { ThemedIcon } from "@/components/icons/themed-icon"
import { appConfig } from "@/config/app-config"
import { ApiRequestError } from "@/data/api-client"
import { useCachedAppInfo } from "@/data/hooks"
import {
  useAuth,
  useAuthenticatedSession,
} from "@/features/auth/auth-context"
import { useClientData } from "@/providers/client-data-provider"

export function AppDrawerContent({ closeDrawer }: { closeDrawer: () => void }) {
  const router = useRouter()
  const theme = useTheme()
  const session = useAuthenticatedSession()
  const appInfoQuery = useCachedAppInfo(session)
  const { currentUser } = useClientData()
  const { isSigningOut, signOut } = useAuth()
  const appName = appInfoQuery.data?.appName ?? appConfig.name
  const organizationName =
    appInfoQuery.data?.organizationName ?? appConfig.organizationName
  const currentUserName =
    currentUser?.nickname.trim() ||
    currentUser?.name.trim() ||
    currentUser?.email ||
    "当前账号"

  function openThemeDebug() {
    closeDrawer()
    router.push("/theme-debug" as Href)
  }

  async function handleLogout() {
    try {
      await signOut()
      closeDrawer()
      router.replace("/init")
    } catch (error: unknown) {
      Alert.alert(
        "退出登录失败",
        error instanceof ApiRequestError
          ? error.message
          : "暂时无法退出登录，请稍后重试。"
      )
    }
  }

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={{
        backgroundColor: String(theme.background.val),
        flex: 1,
      }}
    >
      <YStack bg="$background" flex={1}>
        <YStack px="$4" py="$4">
          <XStack gap="$3" items="center">
            <Image
              alt={`${appName} Logo`}
              borderRadius={10}
              height="$5"
              src={require("../../../assets/images/icon.png")}
              width="$5"
            />
            <YStack flex={1} gap="$1">
              <SizableText fontWeight="600" numberOfLines={1} size="$4">
                {appName}
              </SizableText>
              <Paragraph color="$color10" size="$2">
                {organizationName} 的工作空间
              </Paragraph>
            </YStack>
          </XStack>
        </YStack>

        <YStack flex={1} px="$4" pt="$2">
          <AppButton
            accessibilityLabel="打开调试页面"
            borderColor="$color10"
            color="$color10"
            icon={<Bug color={String(theme.color10.val)} size={20} />}
            onPress={openThemeDebug}
            style={{ borderColor: String(theme.color10.val) }}
            variant="outlined"
            width="100%"
          >
            调试
          </AppButton>
        </YStack>

        <YStack gap="$3" p="$4">
          <ListItem
            borderColor="$color10"
            borderWidth={1}
            icon={
              <Avatar circular size="$3">
                <CachedAvatarImage
                  avatar={currentUser?.avatar ?? ""}
                  server={session}
                />
                <Avatar.Fallback>
                  <Text>{Array.from(currentUserName)[0] ?? "即"}</Text>
                </Avatar.Fallback>
              </Avatar>
            }
            rounded="$4"
            subTitle={currentUser?.email ?? session.url}
            title={currentUserName}
          />
          <AppButton
            accessibilityLabel="退出登录"
            disabled={isSigningOut}
            icon={
              isSigningOut ? <Spinner /> : <ThemedIcon icon={LogOut} />
            }
            onPress={() => void handleLogout()}
            theme="red"
            variant="outlined"
            width="100%"
          >
            {isSigningOut ? "正在退出…" : "退出登录"}
          </AppButton>
        </YStack>
      </YStack>
    </SafeAreaView>
  )
}
