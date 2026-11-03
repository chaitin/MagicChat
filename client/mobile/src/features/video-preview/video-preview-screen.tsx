import { useEvent } from "expo"
import { NavigationBar } from "expo-navigation-bar"
import { Redirect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router"
import { StatusBar } from "expo-status-bar"
import { useVideoPlayer, VideoView } from "expo-video"
import { X } from "lucide-react-native"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppState, Pressable, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Text } from "@/components/mi-sans-text"
import type { AuthenticatedTarget } from "@/core/server-target"
import { ensureAttachmentResource, type ResolvedResource, type ResourceDownloadProgress } from "@/data/resources"
import { formatFileSize } from "@/domain/messages/message-presenter"
import { buildVideoPreviewScope, parseVideoPreviewParams, type VideoPreviewParams, type VideoPreviewSource } from "@/navigation/video-preview"
import { useAuth } from "@/providers/auth-provider"
import { XGUIButton, XGUILoadingIcon, XGUIProgress } from "@/xgui"

type DownloadState =
  | { status: "preparing" }
  | { status: "downloading"; progress: ResourceDownloadProgress }
  | { status: "ready"; resource: ResolvedResource }
  | { status: "error"; message: string }
  | { status: "cancelled" }

export function VideoPreviewScreen() {
  const { fileId, contentType, name, sizeBytes, scope } = useLocalSearchParams<VideoPreviewParams>()
  const { session, generation, phase } = useAuth()
  const parsed = useMemo(() => parseVideoPreviewParams({ fileId, contentType, name, sizeBytes, scope }), [
    fileId, contentType, name, sizeBytes, scope,
  ])

  if (!session) return <Redirect href="/server-management" />
  if (phase !== "authenticated" || (parsed && parsed.scope !== buildVideoPreviewScope(session, generation))) {
    return <Redirect href="/messages" />
  }
  return (
    <AuthenticatedVideoPreview
      key={`${parsed?.scope}:${parsed?.source.fileId}`}
      session={session}
      source={parsed?.source ?? null}
    />
  )
}

function AuthenticatedVideoPreview({ session, source }: {
  session: AuthenticatedTarget
  source: VideoPreviewSource | null
}) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const focused = useIsFocused()
  const [appState, setAppState] = useState(AppState.currentState)
  const [closing, setClosing] = useState(false)
  const active = focused && appState === "active" && !closing
  const [attempt, setAttempt] = useState(0)
  const [playbackAttempt, setPlaybackAttempt] = useState(0)
  const [state, setState] = useState<DownloadState>(() => source
    ? { status: "preparing" }
    : { status: "error", message: "视频信息不存在，请返回后重新打开" })
  const attemptedRef = useRef(-1)
  const interruptedAttemptRef = useRef(-1)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState)
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (!source) return
    if (!active) {
      if (attemptedRef.current === attempt) interruptedAttemptRef.current = attempt
      return
    }
    if (interruptedAttemptRef.current === attempt) return
    attemptedRef.current = attempt
    const controller = new AbortController()
    controllerRef.current = controller
    const handleAbort = () => setState((current) =>
      current.status === "preparing" || current.status === "downloading"
        ? { status: "cancelled" }
        : current)
    controller.signal.addEventListener("abort", handleAbort, { once: true })
    void ensureAttachmentResource(session, {
      fileId: source.fileId,
      fileName: source.name,
      mimeType: source.contentType,
      expectedSizeBytes: source.sizeBytes,
      kind: "video",
      type: "attachment",
    }, {
      signal: controller.signal,
      onPrepare: () => {
        if (!controller.signal.aborted) setState({ status: "preparing" })
      },
      onDownloadStart: () => {
        if (!controller.signal.aborted) setState({
          status: "downloading",
          progress: { bytesWritten: 0, totalBytes: source.sizeBytes },
        })
      },
      onProgress: (progress) => {
        if (!controller.signal.aborted) setState({ status: "downloading", progress })
      },
    }).then((resource) => {
      if (!controller.signal.aborted) setState({ status: "ready", resource })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState({ status: "error", message: downloadErrorMessage(error) })
      }
    })
    return () => {
      controller.abort()
      controller.signal.removeEventListener("abort", handleAbort)
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [active, attempt, session, source])

  const close = useCallback(() => {
    controllerRef.current?.abort()
    setClosing(true)
    if (router.canGoBack()) router.back()
    else router.replace("/messages")
  }, [router])
  const retry = () => {
    setState({ status: "preparing" })
    setAttempt((current) => current + 1)
  }
  const progress = state.status === "downloading" ? state.progress : null
  const percent = progress?.totalBytes
    ? Math.min(100, Math.max(0, Math.floor(progress.bytesWritten / progress.totalBytes * 100)))
    : null

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <NavigationBar hidden={false} style="dark" />
      {state.status === "ready" ? (
        <DownloadedVideo
          key={playbackAttempt}
          active={active}
          resource={state.resource}
          onRetry={() => setPlaybackAttempt((current) => current + 1)}
        />
      ) : (
        <View style={styles.feedback}>
          {state.status === "preparing" || (state.status === "downloading" && percent === null) ? (
            <XGUILoadingIcon color="#fff" size={32} />
          ) : null}
          <Text style={styles.text}>
            {state.status === "preparing" ? "正在准备下载"
              : state.status === "downloading" ? "正在下载视频"
              : state.status === "cancelled" ? "下载已中断"
              : state.message}
          </Text>
          {progress ? (
            <View style={styles.progress}>
              {percent !== null ? <XGUIProgress accessibilityLabel="视频下载进度" value={percent} /> : null}
              <Text style={styles.detail}>
                {percent !== null ? `${percent}% · ` : ""}{formatFileSize(progress.bytesWritten)}
                {progress.totalBytes ? ` / ${formatFileSize(progress.totalBytes)}` : ""}
              </Text>
            </View>
          ) : null}
          {source && (state.status === "error" || state.status === "cancelled") ? (
            <XGUIButton onPress={retry} size="mini">重新下载</XGUIButton>
          ) : null}
        </View>
      )}
      <Pressable
        accessibilityLabel="关闭视频预览"
        accessibilityRole="button"
        hitSlop={8}
        onPress={close}
        style={[styles.close, { top: Math.max(insets.top, 12) }]}
      >
        <X color="#fff" size={26} />
      </Pressable>
    </View>
  )
}

function DownloadedVideo({ active, resource, onRetry }: {
  active: boolean
  resource: ResolvedResource
  onRetry: () => void
}) {
  const player = useVideoPlayer(resource.uri, (instance) => {
    instance.staysActiveInBackground = false
    instance.showNowPlayingNotification = false
  })
  const { status } = useEvent(player, "statusChange", { status: player.status })
  const autoPlayedRef = useRef(false)
  useEffect(() => {
    if (active && status === "readyToPlay" && !autoPlayedRef.current) {
      autoPlayedRef.current = true
      player.play()
    }
  }, [active, player, status])
  useEffect(() => {
    if (!active) player.pause()
    return () => {
      // The hook may already have released the native player during unmount.
      try { player.pause() } catch {}
    }
  }, [active, player])

  if (status === "error") return (
    <View style={styles.feedback}>
      <Text style={styles.text}>视频已下载，但无法播放，可能是视频编码不受支持</Text>
      <XGUIButton onPress={onRetry} size="mini">重试播放</XGUIButton>
    </View>
  )

  return (
    <View style={styles.screen}>
      {/* TextureView follows the page fade; SurfaceView is composited separately. */}
      <VideoView
        buttonOptions={{ showSettings: false }}
        contentFit="contain"
        fullscreenOptions={{ enable: false }}
        nativeControls
        player={player}
        style={styles.screen}
        surfaceType="textureView"
      />
      {status === "loading" ? (
        <View pointerEvents="none" style={styles.preparing}>
          <XGUILoadingIcon color="#fff" size={32} />
          <Text style={styles.text}>正在准备播放</Text>
        </View>
      ) : null}
    </View>
  )
}

function downloadErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "ResourceDownloadError") return error.message
    const status = /response has status: (\d{3})/.exec(error.message)
    if (status) return `视频下载失败（服务器返回 ${status[1]}）`
    if (/Unable to download a file|Missing '.+' permission/i.test(error.message)) {
      return "视频下载失败，文件暂时无法写入，请重试"
    }
    if (/ENOSPC|no space|disk.*full|not enough.*storage/i.test(error.message)) {
      return "存储空间不足，请清理空间后重新下载"
    }
    if (/network|timeout|timed out|connection|internet/i.test(error.message)) {
      return "视频下载失败，请检查网络后重试"
    }
  }
  return "视频下载失败，请检查网络和可用存储空间后重试"
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#000", flex: 1 },
  feedback: { alignItems: "center", flex: 1, gap: 18, justifyContent: "center", paddingHorizontal: 32 },
  text: { color: "#fff", fontSize: 15, lineHeight: 23, textAlign: "center" },
  detail: { color: "#ccc", fontSize: 13, marginTop: 12, textAlign: "center" },
  progress: { maxWidth: 320, width: "100%" },
  close: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 22, height: 44, justifyContent: "center", left: 12, position: "absolute", width: 44, zIndex: 1 },
  preparing: { ...StyleSheet.absoluteFill, alignItems: "center", gap: 16, justifyContent: "center" },
})
