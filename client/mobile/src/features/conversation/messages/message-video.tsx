import { useEvent } from "expo"
import { VideoOff } from "lucide-react-native"
import { useEffect, useRef } from "react"
import { Pressable, StyleSheet } from "react-native"
import { useVideoPlayer, VideoView } from "expo-video"

import type { ResourceLoadState } from "@/data/resources"
import { XGUILoadingIcon, useXGUITheme } from "@/xgui"

export function MessageVideo({
  onLongPress,
  onReload,
  roundedBottom,
  state,
}: {
  onLongPress: () => void
  onReload: () => void
  roundedBottom: boolean
  state: ResourceLoadState | undefined
}) {
  const { colors } = useXGUITheme()
  const uri = state?.resource?.uri ?? null
  const player = useVideoPlayer(uri)
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  })
  const reloadedURIRef = useRef("")
  const initialLoadRequestedRef = useRef(false)

  useEffect(() => {
    if (state?.status !== "idle" || initialLoadRequestedRef.current) return
    initialLoadRequestedRef.current = true
    onReload()
  }, [onReload, state?.status])

  useEffect(() => {
    if (status !== "error" || !uri || reloadedURIRef.current === uri) return
    reloadedURIRef.current = uri
    onReload()
  }, [onReload, status, uri])

  const radiusStyle = roundedBottom
    ? styles.rounded
    : styles.roundedTop
  if (!uri) {
    const failed = state?.status === "error"
    return (
      <Pressable
        accessibilityLabel={failed ? "重新加载视频" : "视频加载中"}
        accessibilityRole={failed ? "button" : "progressbar"}
        disabled={false}
        onLongPress={onLongPress}
        onPress={failed ? onReload : undefined}
        style={[
          styles.placeholder,
          radiusStyle,
          { backgroundColor: colors.background1 },
        ]}
      >
        {failed ? (
          <VideoOff color={colors.textPlaceholder} size={26} />
        ) : (
          <XGUILoadingIcon color={colors.textPlaceholder} size={24} />
        )}
      </Pressable>
    )
  }

  return (
    <Pressable onLongPress={onLongPress} style={[styles.videoFrame, radiusStyle]}>
      <VideoView
        contentFit="contain"
        fullscreenOptions={{ enable: true }}
        nativeControls
        player={player}
        style={styles.video}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: "center",
    aspectRatio: 16 / 9,
    justifyContent: "center",
    overflow: "hidden",
    width: "100%",
  },
  rounded: {
    borderRadius: 7,
  },
  roundedTop: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
  },
  video: {
    flex: 1,
  },
  videoFrame: {
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    overflow: "hidden",
    width: "100%",
  },
})
