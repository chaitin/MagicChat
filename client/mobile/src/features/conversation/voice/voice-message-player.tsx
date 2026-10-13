import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from "expo-audio"
import { useCallback, useEffect, useRef, useState } from "react"
import { Pressable, View } from "react-native"
import { Text } from "@/components/mi-sans-text"

import { MessageActionButton } from "@/features/conversation/messages/message-action-button"
import { MessageContentIcon } from "@/features/conversation/messages/message-content-icon"
import type { ResourceLoadState } from "@/data/resources"
import { formatVoicePlaybackTime } from "@/features/conversation/voice/voice-message-presentation"
import {
  activateVoicePlayer,
  deactivateVoicePlayer,
} from "@/features/conversation/voice/voice-message-player-state"
import { useXGUITheme, useXGUIToast } from "@/xgui"

export function VoiceMessagePlayer({
  durationMS,
  fileId,
  onLongPress,
  onResourceError,
  onResourceRequest,
  state,
  transcript,
}: {
  durationMS: number
  fileId: string
  onLongPress: () => void
  onResourceError: (fileId: string) => void
  onResourceRequest: (fileId: string) => void
  state: ResourceLoadState | undefined
  transcript: string
}) {
  const { colors } = useXGUITheme()
  const toast = useXGUIToast()
  const resourceUri = state?.resource?.uri ?? ""
  const player = useAudioPlayer(resourceUri || null, { updateInterval: 100 })
  const playerStatus = useAudioPlayerStatus(player)
  const playerId = player.id
  const didLongPressRef = useRef(false)
  const playWhenReadyRef = useRef(false)
  const retriedResourceRef = useRef(false)
  const shownPlaybackErrorRef = useRef("")
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const displayedDuration = hasPlaybackStarted && !playerStatus.didJustFinish && !playerStatus.error
    ? playerStatus.currentTime * 1_000
    : durationMS
  const isLoading =
    isStarting || state?.status === "loading" ||
    (resourceUri.length > 0 && playerStatus.isBuffering)

  const startPlayback = useCallback(async () => {
    setIsStarting(true)
    setHasPlaybackStarted(true)
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        interruptionMode: "doNotMix",
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      })
      if (
        playerStatus.didJustFinish ||
        (player.duration > 0 && player.currentTime >= player.duration - 0.05)
      ) {
        await player.seekTo(0)
      }
      activateVoicePlayer({ id: playerId, pause: () => player.pause() })
      player.play()
    } catch (error: unknown) {
      setHasPlaybackStarted(false)
      deactivateVoicePlayer(player.id)
      toast.show({ message: `${"无法播放语音"}：${error instanceof Error ? error.message : "请稍后重试"}`, modal: false, type: "text", duration: 1_000 })
    } finally {
      setIsStarting(false)
    }
  }, [player, playerId, playerStatus.didJustFinish, toast])

  useEffect(() => {
    if (!resourceUri || !playWhenReadyRef.current) return
    playWhenReadyRef.current = false
    void startPlayback()
  }, [resourceUri, startPlayback])

  useEffect(() => {
    const subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish || status.error) {
        setHasPlaybackStarted(false)
        deactivateVoicePlayer(playerId)
      }
    })
    return () => subscription.remove()
  }, [player, playerId])

  useEffect(() => {
    const playbackError = playerStatus.error?.trim() ?? ""
    if (!playbackError) {
      shownPlaybackErrorRef.current = ""
      return
    }
    if (!retriedResourceRef.current) {
      retriedResourceRef.current = true
      playWhenReadyRef.current = true
      onResourceError(fileId)
      return
    }
    if (shownPlaybackErrorRef.current === playbackError) return

    shownPlaybackErrorRef.current = playbackError
    toast.show({ message: `${"无法播放语音"}：${playbackError}`, modal: false, type: "text", duration: 1_000 })
  }, [fileId, onResourceError, playerStatus.error, toast])

  useEffect(
    () => () => {
      deactivateVoicePlayer(playerId)
    },
    [playerId]
  )

  function handlePress() {
    if (didLongPressRef.current) {
      didLongPressRef.current = false
      return
    }
    if (isLoading) return
    if (playerStatus.playing) {
      player.pause()
      deactivateVoicePlayer(playerId)
      return
    }

    if (!resourceUri) {
      playWhenReadyRef.current = true
      onResourceRequest(fileId)
      return
    }

    void startPlayback()
  }

  return (
    <Pressable
      accessible={false}
      onLongPress={() => {
        didLongPressRef.current = true
        onLongPress()
      }}
      style={{ alignItems: "center", flexDirection: "row", gap: 12, width: "100%" }}
    >
      <MessageContentIcon color={colors.textPrimary} kind="voice" size={28} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: colors.textPrimary, fontSize: 14, lineHeight: 24 }}>
          语音 - {formatVoicePlaybackTime(displayedDuration)}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 16 }}>
          {transcript || "暂无文字摘要"}
        </Text>
      </View>
      <MessageActionButton
        accessibilityLabel={isLoading ? "正在加载语音" : playerStatus.playing ? "暂停语音" : "播放语音"}
        kind={isLoading ? "loading" : playerStatus.playing ? "pause" : "play"}
        strokeWidth={isLoading ? 1.5 : 2}
        disabled={isLoading}
        onLongPress={() => {
          didLongPressRef.current = true
          onLongPress()
        }}
        onPress={handlePress}
        onPressIn={() => {
          didLongPressRef.current = false
        }}
      />
    </Pressable>
  )
}
