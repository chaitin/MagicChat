import { FileText } from "lucide-react-native"
import {
  Dialog,
  Image,
  SizableText,
  Spinner,
  VisuallyHidden,
  XStack,
  YStack,
} from "tamagui"

import { AppButton } from "@/components/forms/app-button"
import { ThemedIcon } from "@/components/icons/themed-icon"
import type { PreparedClientMessageUpload } from "@/data/message-upload"
import { formatFileSize } from "@/domain/messages/message-presenter"

export function MessageUploadDialog({
  onCancel,
  onConfirm,
  selection,
  sending,
}: {
  onCancel: () => void
  onConfirm: () => void
  selection: PreparedClientMessageUpload | null
  sending: boolean
}) {
  if (!selection) return null

  const isImage = selection.kind === "image"

  return (
    <Dialog
      modal
      onOpenChange={(open) => {
        if (!open && !sending) onCancel()
      }}
      open
    >
      <Dialog.Portal>
        <Dialog.Overlay bg="$shadow6" opacity={0.5} />
        <Dialog.Content bordered elevate gap="$4" maxW={440} width="90%">
          <Dialog.Title fontSize="$4" lineHeight="$5">
            {isImage ? "发送图片" : "发送文件"}
          </Dialog.Title>
          <VisuallyHidden>
            <Dialog.Description>
              确认将所选{isImage ? "图片" : "文件"}发送到当前会话
            </Dialog.Description>
          </VisuallyHidden>

          {isImage ? (
            <Image
              accessibilityLabel="待发送图片预览"
              bg="$gray2"
              height={220}
              objectFit="contain"
              rounded="$3"
              src={selection.upload.uri}
              width="100%"
            />
          ) : (
            <XStack
              borderColor="$borderColor"
              borderWidth={1}
              gap="$3"
              items="center"
              p="$3"
              rounded="$3"
            >
              <ThemedIcon icon={FileText} size={24} />
              <YStack flex={1} minW={0}>
                <SizableText fontWeight="500" numberOfLines={1} size="$3">
                  {selection.upload.name}
                </SizableText>
                <SizableText color="$gray9" size="$2">
                  {formatFileSize(selection.upload.sizeBytes)}
                </SizableText>
              </YStack>
            </XStack>
          )}

          <XStack gap="$3" width="100%">
            <AppButton
              accessibilityLabel="取消发送"
              disabled={sending}
              grow={1}
              onPress={onCancel}
              theme="gray"
            >
              取消
            </AppButton>
            <AppButton
              accessibilityLabel={isImage ? "发送图片" : "发送文件"}
              disabled={sending}
              grow={1}
              icon={sending ? <Spinner /> : undefined}
              onPress={onConfirm}
              theme="accent"
            >
              {sending ? "发送中…" : "发送"}
            </AppButton>
          </XStack>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
