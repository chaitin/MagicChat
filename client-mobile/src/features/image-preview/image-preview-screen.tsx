import { NavigationBar } from "expo-navigation-bar"
import { Redirect, useLocalSearchParams, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { Download, X } from "lucide-react-native"
import { useEffect, useState } from "react"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import {
  Button,
  SizableText,
  Spinner,
  useToastController,
  YStack,
} from "tamagui"

import type { AppToastTone } from "@/components/feedback/app-toast"
import type { AuthenticatedTarget } from "@/data/query"
import {
  ensureAttachmentResource,
  invalidateAttachmentResource,
  MediaLibraryPermissionError,
  saveImageToMediaLibrary,
  type ResolvedResource,
} from "@/data/resources"
import { useAuth } from "@/features/auth/auth-context"
import { ZoomableImage } from "@/features/image-preview/zoomable-image"

export function ImagePreviewScreen() {
  const params = useLocalSearchParams<{ fileId?: string | string[] }>()
  const { session } = useAuth()
  const fileId = Array.isArray(params.fileId)
    ? (params.fileId[0] ?? "")
    : (params.fileId ?? "")

  if (!session) return <Redirect href="/init" />

  return <AuthenticatedImagePreview fileId={fileId} session={session} />
}

function AuthenticatedImagePreview({
  fileId,
  session,
}: {
  fileId: string
  session: AuthenticatedTarget
}) {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const toast = useToastController()
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<Error | null>(() =>
    fileId ? null : new Error("图片信息不存在")
  )
  const [imageReady, setImageReady] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [resource, setResource] = useState<ResolvedResource | null>(null)

  useEffect(() => {
    if (!fileId) return

    const controller = new AbortController()

    void ensureAttachmentResource(
      session,
      { fileId, kind: "image", type: "attachment" },
      { signal: controller.signal }
    )
      .then(setResource)
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return
        setError(
          loadError instanceof Error ? loadError : new Error("图片加载失败")
        )
      })

    return () => controller.abort()
  }, [attempt, fileId, session])

  async function handleRetry() {
    if (!fileId) return
    setError(null)
    setImageReady(false)
    setResource(null)
    await invalidateAttachmentResource(session, {
      fileId,
      kind: "image",
      type: "attachment",
    }).catch(() => undefined)
    setAttempt((current) => current + 1)
  }

  async function handleSave() {
    if (!resource || isSaving) return
    setIsSaving(true)

    try {
      await saveImageToMediaLibrary(resource)
      toast.show("图片已保存", {
        customData: { tone: "success" satisfies AppToastTone },
        message: "已保存到系统相册",
      })
    } catch (saveError: unknown) {
      toast.show("保存失败", {
        customData: { tone: "error" satisfies AppToastTone },
        duration: 4000,
        message:
          saveError instanceof MediaLibraryPermissionError
            ? "请在系统设置中允许即应访问相册"
            : saveError instanceof Error
              ? saveError.message
              : "请稍后重试",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <YStack bg="#000" flex={1}>
      <StatusBar hidden />
      <NavigationBar hidden={false} style="dark" />

      {resource ? (
        <ZoomableImage
          onError={() => setError(new Error("图片无法显示，请重新加载"))}
          onLoad={() => setImageReady(true)}
          onPress={() => router.back()}
          uri={resource.uri}
        />
      ) : null}

      {!resource || !imageReady ? (
        <YStack
          b={0}
          gap="$4"
          items="center"
          justify="center"
          l={0}
          position="absolute"
          r={0}
          t={0}
        >
          {error ? (
            <>
              <SizableText color="#fff" maxW={280} text="center">
                {error.message}
              </SizableText>
              <Button onPress={() => void handleRetry()} theme="teal">
                重新加载
              </Button>
            </>
          ) : (
            <Spinner color="#fff" size="large" />
          )}
        </YStack>
      ) : null}

      <Button
        accessibilityLabel="关闭图片预览"
        bg="rgba(0, 0, 0, 0.45)"
        borderColor="rgba(255, 255, 255, 0.2)"
        borderWidth={1}
        circular
        icon={<X color="#fff" size={22} />}
        l={16}
        onPress={() => router.back()}
        position="absolute"
        pressStyle={{ bg: "rgba(255, 255, 255, 0.16)" }}
        size="$4"
        t={Math.max(insets.top, 16)}
      />

      {resource && imageReady ? (
        <Button
          accessibilityLabel="保存图片到相册"
          bg="rgba(0, 0, 0, 0.45)"
          borderColor="rgba(255, 255, 255, 0.2)"
          borderWidth={1}
          b={Math.max(insets.bottom, 16)}
          circular
          disabled={isSaving}
          icon={
            isSaving ? (
              <Spinner color="#fff" />
            ) : (
              <Download color="#fff" size={22} />
            )
          }
          onPress={() => void handleSave()}
          position="absolute"
          pressStyle={{ bg: "rgba(255, 255, 255, 0.16)" }}
          r={16}
          size="$5"
        />
      ) : null}
    </YStack>
  )
}
