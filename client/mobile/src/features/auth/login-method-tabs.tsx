import type { ReactNode } from "react"
import { Paragraph, SizableText, Tabs, YStack } from "tamagui"

import { useXGUITheme } from "@/xgui"

export type LoginMethod = "email-code" | "password"

export function resolveLoginMethod({
  emailCodeLoginEnabled,
  passwordLoginEnabled,
  preferredMethod,
}: {
  emailCodeLoginEnabled: boolean
  passwordLoginEnabled: boolean
  preferredMethod: LoginMethod
}): LoginMethod | null {
  if (emailCodeLoginEnabled && passwordLoginEnabled) return preferredMethod
  if (emailCodeLoginEnabled) return "email-code"
  if (passwordLoginEnabled) return "password"
  return null
}

export function LoginMethodTabs({
  activeMethod,
  disabled,
  emailCodeContent,
  emailCodeLoginEnabled,
  onMethodChange,
  passwordContent,
  passwordLoginEnabled,
}: {
  activeMethod: LoginMethod | null
  disabled: boolean
  emailCodeContent: ReactNode
  emailCodeLoginEnabled: boolean
  onMethodChange: (method: LoginMethod) => void
  passwordContent: ReactNode
  passwordLoginEnabled: boolean
}) {
  const { colors } = useXGUITheme()

  if (!activeMethod) {
    return (
      <YStack items="center" py="$4">
        <Paragraph color="$gray9">服务器暂不支持登录</Paragraph>
      </YStack>
    )
  }

  if (!emailCodeLoginEnabled || !passwordLoginEnabled) {
    return activeMethod === "email-code" ? emailCodeContent : passwordContent
  }

  return (
    <Tabs
      onValueChange={(value) => {
        if (value === "email-code" || value === "password") {
          onMethodChange(value)
        }
      }}
      size="$4"
      value={activeMethod}
      width="100%"
    >
      <Tabs.List
        bg={colors.background1}
        borderWidth={0}
        gap="$0.5"
        height="$4"
        p="$1"
        rounded="$5"
        width="100%"
      >
        {emailCodeLoginEnabled ? (
          <Tabs.Tab
            bg={
              activeMethod === "email-code"
                ? colors.background2
                : "transparent"
            }
            borderWidth={0}
            disabled={disabled}
            flex={1}
            height="100%"
            items="center"
            justify="center"
            rounded="$4"
            unstyled
            value="email-code"
          >
            <SizableText
              color={
                activeMethod === "email-code"
                  ? colors.brand
                  : colors.textSecondary
              }
              fontWeight={activeMethod === "email-code" ? "600" : "500"}
              size="$3"
            >
              验证码登录
            </SizableText>
          </Tabs.Tab>
        ) : null}
        {passwordLoginEnabled ? (
          <Tabs.Tab
            bg={
              activeMethod === "password" ? colors.background2 : "transparent"
            }
            borderWidth={0}
            disabled={disabled}
            flex={1}
            height="100%"
            items="center"
            justify="center"
            rounded="$4"
            unstyled
            value="password"
          >
            <SizableText
              color={
                activeMethod === "password"
                  ? colors.brand
                  : colors.textSecondary
              }
              fontWeight={activeMethod === "password" ? "600" : "500"}
              size="$3"
            >
              密码登录
            </SizableText>
          </Tabs.Tab>
        ) : null}
      </Tabs.List>

      {emailCodeLoginEnabled ? (
        <Tabs.Content pt="$4" value="email-code" width="100%">
          {emailCodeContent}
        </Tabs.Content>
      ) : null}
      {passwordLoginEnabled ? (
        <Tabs.Content pt="$4" value="password" width="100%">
          {passwordContent}
        </Tabs.Content>
      ) : null}
    </Tabs>
  )
}
