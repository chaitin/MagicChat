import { useEffect, useRef, useState } from "react"
import { Keyboard, Platform } from "react-native"
import {
  type ColorTokens,
  Dialog,
  Paragraph,
  type TamaguiElement,
  useTheme,
  VisuallyHidden,
  XStack,
} from "tamagui"

import { AppButton } from "@/components/forms/app-button"
import { AppInput } from "@/components/forms/app-input"
import { useServers } from "@/features/servers/server-context"
import { isValidServerUrl } from "@/features/servers/server-model"

const SERVER_NAME_INPUT_ID = "new-server-name"
const SERVER_URL_INPUT_ID = "new-server-url"

export function AddServerDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { addServer } = useServers()
  const theme = useTheme()
  const accentColor = theme.color10.val as ColorTokens
  const urlInputRef = useRef<TamaguiElement>(null)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const canAdd = name.trim().length > 0 && isValidServerUrl(url)

  useEffect(() => {
    if (!open) {
      return
    }

    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow"
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide"
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height)
    })
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0)
    })

    return () => {
      showSubscription.remove()
      hideSubscription.remove()
    }
  }, [open])

  function resetForm() {
    setName("")
    setUrl("")
    setErrorMessage("")
  }

  function closeDialog() {
    Keyboard.dismiss()
    setKeyboardHeight(0)
    resetForm()
    onOpenChange(false)
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen && keyboardHeight > 0) {
      Keyboard.dismiss()
      return
    }

    if (!nextOpen) {
      resetForm()
    }
    onOpenChange(nextOpen)
  }

  function handleAdd() {
    if (!canAdd) {
      setErrorMessage("请填写服务器名称和有效的 HTTP 或 HTTPS 地址")
      return
    }

    const result = addServer(name, url)

    if (result.status === "duplicate") {
      setErrorMessage("该服务器地址已经存在")
      return
    }

    if (result.status === "invalid") {
      setErrorMessage("请填写服务器名称和有效的 HTTP 或 HTTPS 地址")
      return
    }

    closeDialog()
  }

  return (
    <Dialog modal onOpenChange={handleDialogOpenChange} open={open}>
      <Dialog.Portal
        onTouchEnd={(event) => {
          if (event.target === event.currentTarget) {
            Keyboard.dismiss()
          }
        }}
        pb={keyboardHeight}
      >
        <Dialog.Overlay
          bg="$shadow6"
          opacity={0.5}
          pointerEvents="none"
        />
        <Dialog.Content bordered elevate gap="$4" maxW={440} width="90%">
          <Dialog.Title fontSize="$5" lineHeight="$6">
            添加服务器
          </Dialog.Title>
          <VisuallyHidden>
            <Dialog.Description>
              添加一个可供即应登录使用的服务器。
            </Dialog.Description>
          </VisuallyHidden>

          <AppInput
            accessibilityLabel="服务器名称"
            color="$gray12"
            cursorColor={accentColor}
            id={SERVER_NAME_INPUT_ID}
            onChangeText={(value) => {
              setName(value)
              setErrorMessage("")
            }}
            onSubmitEditing={() => urlInputRef.current?.focus()}
            placeholder="服务器名称"
            placeholderTextColor="$gray9"
            returnKeyType="next"
            selectionColor={accentColor}
            value={name}
          />

          <AppInput
            accessibilityLabel="服务器地址"
            autoCapitalize="none"
            autoCorrect={false}
            caretHidden={false}
            color="$gray12"
            cursorColor={accentColor}
            id={SERVER_URL_INPUT_ID}
            onChangeText={(value) => {
              setUrl(value)
              setErrorMessage("")
            }}
            onSubmitEditing={handleAdd}
            placeholder="https://example.com"
            placeholderTextColor="$gray9"
            ref={urlInputRef}
            returnKeyType="done"
            selectionColor={accentColor}
            value={url}
          />

          {errorMessage ? (
            <Paragraph color="$red10" size="$2">
              {errorMessage}
            </Paragraph>
          ) : null}

          <XStack gap="$3" width="100%">
            <AppButton
              accessibilityLabel="取消添加服务器"
              grow={1}
              onPress={closeDialog}
              theme="gray"
            >
              取消
            </AppButton>
            <AppButton
              accessibilityLabel="添加服务器"
              grow={1}
              onPress={handleAdd}
              theme="accent"
            >
              添加
            </AppButton>
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
