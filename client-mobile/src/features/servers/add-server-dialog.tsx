import { useEffect, useRef, useState } from "react"
import { Keyboard, Platform } from "react-native"
import {
  type ColorTokens,
  Dialog,
  Paragraph,
  SizableText,
  type TamaguiElement,
  useTheme,
  VisuallyHidden,
  XStack,
} from "tamagui"

import { AppButton } from "@/components/forms/app-button"
import { AppInput } from "@/components/forms/app-input"
import { useServers } from "@/features/servers/server-context"
import {
  isValidServerUrl,
  type ServerConfig,
} from "@/features/servers/server-model"

const SERVER_NAME_INPUT_ID = "new-server-name"
const SERVER_URL_INPUT_ID = "new-server-url"
const SERVER_URL_PREFIX = "https://"

type AddServerDialogProps = {
  onOpenChange: (open: boolean) => void
  onSaved?: (server: ServerConfig, previousServer: ServerConfig | null) => void
  open: boolean
  server?: ServerConfig | null
}

export function AddServerDialog(props: AddServerDialogProps) {
  if (!props.open) return null

  return <OpenServerDialog {...props} server={props.server ?? null} />
}

function OpenServerDialog({
  onOpenChange,
  onSaved,
  open,
  server,
}: AddServerDialogProps & { server: ServerConfig | null }) {
  const { addServer, updateServer } = useServers()
  const theme = useTheme()
  const accentColor = theme.color10.val as ColorTokens
  const urlInputRef = useRef<TamaguiElement>(null)
  const [name, setName] = useState(server?.name ?? "")
  const [urlAddress, setUrlAddress] = useState(() =>
    stripServerUrlPrefix(server?.url ?? "")
  )
  const [errorMessage, setErrorMessage] = useState("")
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const url = `${SERVER_URL_PREFIX}${urlAddress.trim()}`
  const canSave = name.trim().length > 0 && isValidServerUrl(url)
  const isEditing = Boolean(server)

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
    setUrlAddress("")
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

  function handleSave() {
    if (!canSave) {
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
      setErrorMessage("该服务器已不存在，请关闭后重试")
      return
    }

    if (!("server" in result)) return

    onSaved?.(result.server, server)
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
            {isEditing ? "修改服务器" : "添加服务器"}
          </Dialog.Title>
          <VisuallyHidden>
            <Dialog.Description>
              {isEditing
                ? "修改服务器名称和地址。"
                : "添加一个可供即应登录使用的服务器。"}
            </Dialog.Description>
          </VisuallyHidden>

          <AppInput
            accessibilityLabel="服务器名称"
            color="$gray12"
            cursorColor={accentColor}
            defaultValue={server?.name ?? ""}
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
          />

          <XStack position="relative" width="100%">
            <AppInput
              accessibilityLabel="服务器地址，固定使用 HTTPS"
              autoCapitalize="none"
              autoComplete="url"
              autoCorrect={false}
              caretHidden={false}
              color="$gray12"
              cursorColor={accentColor}
              id={SERVER_URL_INPUT_ID}
              keyboardType="url"
              onChangeText={(value) => {
                setUrlAddress(stripServerUrlPrefix(value))
                setErrorMessage("")
              }}
              onSubmitEditing={handleSave}
              pl={72}
              placeholder="example.com"
              placeholderTextColor="$gray9"
              ref={urlInputRef}
              returnKeyType="done"
              selectionColor={accentColor}
              spellCheck={false}
              value={urlAddress}
              width="100%"
            />
            <XStack
              b={0}
              items="center"
              l="$3"
              pointerEvents="none"
              position="absolute"
              t={0}
            >
              <SizableText color="$gray12" size="$4">
                {SERVER_URL_PREFIX}
              </SizableText>
            </XStack>
          </XStack>

          {errorMessage ? (
            <Paragraph color="$red10" size="$2">
              {errorMessage}
            </Paragraph>
          ) : null}

          <XStack gap="$3" width="100%">
            <AppButton
              accessibilityLabel={isEditing ? "取消修改服务器" : "取消添加服务器"}
              grow={1}
              onPress={closeDialog}
              theme="gray"
            >
              取消
            </AppButton>
            <AppButton
              accessibilityLabel={isEditing ? "保存服务器" : "添加服务器"}
              grow={1}
              onPress={handleSave}
              theme="accent"
            >
              {isEditing ? "保存" : "添加"}
            </AppButton>
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function stripServerUrlPrefix(value: string) {
  return value.trimStart().replace(/^https?:\/\//i, "")
}
