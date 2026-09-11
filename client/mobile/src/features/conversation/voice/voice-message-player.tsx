import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from "expo-audio"
import { AudioLines, Pause, Play } from "lucide-react-native"
import { useCallback, useEffect, useRef } from "react"
import {
  Button,
  Paragraph,
  SizableText,
  XStack,
  YStack,
} from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"
import type { ResourceLoadState } from "@/data/resources"
import { formatVoiceDuration } from "@/domain/messages/message-presenter"
import {
  activateVoicePlayer,
  deactivateVoicePlayer,
} from "@/features/conversation/voice/voice-message-player-state"
import { XGUILoadingIcon, useXGUITheme, useXGUIToast } from "@/xgui"

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
  const isLoading =
    state?.status === "loading" ||
    (resourceUri.length > 0 && playerStatus.isBuffering)

  const startPlayback = useCallback(async () => {
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
      deactivateVoicePlayer(player.id)
      toast.show({ message: `${"无法播放语音"}：${error instanceof Error ? error.message : "请稍后重试"}`, modal: false, type: "text", duration: 1_000 })
    }
  }, [player, playerId, playerStatus.didJustFinish, toast])

  useEffect(() => {
    if (!resourceUri || !playWhenReadyRef.current) return
    playWhenReadyRef.current = false
    void startPlayback()
  }, [resourceUri, startPlayback])

  useEffect(() => {
    if (playerStatus.didJustFinish) deactivateVoicePlayer(playerId)
  }, [playerId, playerStatus.didJustFinish])

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
    <YStack
      gap="$2"
      onLongPress={() => {
        didLongPressRef.current = true
        onLongPress()
      }}
      width="100%"
    >
      <XStack gap="$3" items="center">
        <ThemedIcon
          color={colors.brand5}
          icon={AudioLines}
          size={22}
        />
        <SizableText color={colors.brand5} flex={1} size="$4">
          语音 {formatVoiceDuration(durationMS)}
        </SizableText>
        <Button
          accessibilityLabel={playerStatus.playing ? "暂停语音" : "播放语音"}
          chromeless
          circular
          disabled={isLoading}
          icon={
            isLoading ? (
              <XGUILoadingIcon color={colors.brand5} size={18} />
            ) : (
              <ThemedIcon
                color={colors.brand5}
                icon={playerStatus.playing ? Pause : Play}
                size={18}
              />
            )
          }
          onLongPress={() => {
            didLongPressRef.current = true
            onLongPress()
          }}
          onPress={handlePress}
          onPressIn={() => {
            didLongPressRef.current = false
          }}
          size="$3"
        />
      </XStack>
      {transcript ? (
        <Paragraph color={colors.textSecondary} size="$3">
          {transcript}
        </Paragraph>
      ) : null}
    </YStack>
  )
}
