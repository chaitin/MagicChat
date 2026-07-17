import { usePathname, useRouter, type Href } from "expo-router"
import { Check, ChevronRight, LogOut } from "lucide-react-native"
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
  Theme,
  useTheme,
  XStack,
  YStack,
} from "tamagui"

import { CachedAvatarImage } from "@/components/avatar/cached-avatar-image"
import { AppButton } from "@/components/forms/app-button"
import { ThemedIcon } from "@/components/icons/themed-icon"
import { AppListItem } from "@/components/lists/app-list-item"
import { appConfig } from "@/config/app-config"
import { ApiRequestError } from "@/data/api-client"
import { useCachedAppInfo } from "@/data/hooks"
import {
  useAuth,
  useAuthenticatedSession,
} from "@/features/auth/auth-context"
import { appSections } from "@/navigation/app-sections"
import { useClientData } from "@/providers/client-data-provider"

export function AppDrawerContent({ closeDrawer }: { closeDrawer: () => void }) {
  const pathname = usePathname()
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

  function navigateTo(href: Href) {
    closeDrawer()
    router.replace(href)
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

        <YStack flex={1} gap="$2" px="$4" pt="$2">
          <Paragraph color="$color10" px="$1" size="$2">
            工作台
          </Paragraph>
          {appSections.map((item) => {
            const active = pathname.endsWith(`/${item.routeName}`)

            return (
              <Theme key={item.routeName} name={active ? "teal" : "gray"}>
                <AppListItem
                  accessibilityLabel={`打开${item.label}`}
                  bg={active ? "$color2" : undefined}
                  borderColor={active ? "$color10" : "$color7"}
                  icon={<ThemedIcon icon={item.icon} />}
                  iconAfter={
                    <ThemedIcon icon={active ? Check : ChevronRight} />
                  }
                  onPress={() => navigateTo(item.href)}
                  size="$4"
                  title={item.label}
                />
              </Theme>
            )
          })}
        </YStack>

        <YStack gap="$3" p="$4">
          <Theme name="gray">
            <ListItem
              borderColor="$color7"
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
              subTitle={currentUser?.email ?? session.url}
              title={currentUserName}
              variant="outlined"
            />
          </Theme>
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
