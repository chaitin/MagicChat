import { Redirect, useRouter } from "expo-router"
import { Linking, Pressable } from "react-native"
import { Image, Paragraph, XStack, YStack } from "tamagui"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { appConfig } from "@/config/app-config"
import { useCachedAppInfo } from "@/data/hooks"
import { useAuth } from "@/features/auth/auth-context"
import { LoginForm } from "@/features/auth/login-form"
import { useServers } from "@/features/servers/server-context"

const COMPANY_WEBSITE_URL = "https://baizhi.cloud/"

export function LoginScreen() {
  const router = useRouter()
  const { isAuthenticated } = useAuth()
  const { isHydrated, selectedServer } = useServers()
  const appInfoQuery = useCachedAppInfo(selectedServer)

  if (isAuthenticated) {
    return <Redirect href="/(app)/(tabs)/messages" />
  }

  if (!isHydrated || !appInfoQuery.data) {
    return <Redirect href="/init" />
  }

  const appInfo = appInfoQuery.data
  const appName = appInfo.appName || appConfig.name
  const organizationName =
    appInfo.organizationName || appConfig.organizationName

  return (
    <KeyboardAwareScreen items="center" pb="$5" pt="$3" px="$5">
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
            <YStack gap="$1.5" shrink={1}>
              <Paragraph fontSize="$5" fontWeight="600" lineHeight="$6">
                {appName} 智能协作平台
              </Paragraph>
              <Paragraph color="$color10" fontSize="$3">
                {organizationName} 的工作空间
              </Paragraph>
            </YStack>
          </XStack>

          <LoginForm
            emailCodeLoginEnabled={appInfo.emailCodeLoginEnabled}
            onLoginSuccess={() => router.replace("/init")}
            passwordLoginEnabled={appInfo.passwordLoginEnabled}
            server={selectedServer}
          />
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
  )
}
