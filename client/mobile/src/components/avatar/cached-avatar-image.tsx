import { useCallback, useEffect, useRef, useState } from "react"
import * as FileSystem from "expo-file-system/legacy"
import { Image as NativeImage, Platform, StyleSheet, View } from "react-native"
import { SvgXml } from "react-native-svg"
import { Avatar } from "tamagui"

import {
  isSvgContent,
  isSvgUrl,
  normalizeAvatarSvgContent,
} from "@/components/avatar/avatar-resource-format"
import {
  getCachedAvatarFormat,
  getCachedAvatarSvg,
  setCachedAvatarFormat,
  setCachedAvatarSvg,
} from "@/components/avatar/avatar-render-cache"
import type { ServerTarget } from "@/core/server-target"
import { useCachedAvatar } from "@/data/resources"
import { useXGUITheme } from "@/xgui"

export function CachedAvatarImage({
  avatar,
  server,
}: {
  avatar: string
  server: ServerTarget
}) {
  const { error, isLoading, refetch, sourceUrl, uri } = useCachedAvatar(
    server,
    avatar
  )

  return uri ? (
    <CachedAvatarResource
      key={`${sourceUrl}:${uri}`}
      refetch={refetch}
      sourceUrl={sourceUrl}
      uri={uri}
    />
  ) : isLoading && !error ? (
    <AvatarImageSurface />
  ) : null
}

export function CachedAvatarTileImage({
  avatar,
  onReady,
  server,
}: {
  avatar: string
  onReady?: () => void
  server: ServerTarget
}) {
  const { error, isLoading, refetch, sourceUrl, uri } = useCachedAvatar(
    server,
    avatar
  )
  useEffect(() => {
    if (!uri && !isLoading) onReady?.()
  }, [isLoading, onReady, uri])

  return uri ? (
    <CachedAvatarResource
      key={`${sourceUrl}:${uri}`}
      onReady={onReady}
      refetch={refetch}
      sourceUrl={sourceUrl}
      tile
      uri={uri}
    />
  ) : isLoading && !error ? (
    <AvatarImageSurface transparentBackground />
  ) : null
}

function CachedAvatarResource({
  onReady,
  refetch,
  sourceUrl,
  tile = false,
  uri,
}: {
  onReady?: () => void
  refetch: () => Promise<unknown>
  sourceUrl: string
  tile?: boolean
  uri: string
}) {
  const svg = useSvgResourceDetection(sourceUrl, uri)

  if (svg === null) return <AvatarImageSurface transparentBackground={tile} />
  if (svg) return (
    <RetryableSvgImage
      onReady={onReady}
      refetch={refetch}
      transparentBackground={tile}
      uri={uri}
    />
  )
  return tile ? (
    <RetryableTileImage onReady={onReady} refetch={refetch} uri={uri} />
  ) : (
    <RetryableAvatarImage refetch={refetch} uri={uri} />
  )
}

function useSvgResourceDetection(sourceUrl: string, uri: string) {
  const hintedSvg = isSvgUrl(sourceUrl) || isSvgUrl(uri)
  const [detectedSvg, setDetectedSvg] = useState<boolean | null>(() =>
    hintedSvg || Platform.OS === "web"
      ? hintedSvg
      : (getCachedAvatarFormat(uri) ?? null)
  )

  useEffect(() => {
    if (hintedSvg || Platform.OS === "web") return
    let active = true
    FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.UTF8,
      length: 8192,
      position: 0,
    })
      .then(
        (content) => {
          if (active) {
            const isSvg = isSvgContent(content)
            setCachedAvatarFormat(uri, isSvg)
            setDetectedSvg(isSvg)
          }
        },
        () => {
          if (active) {
            setDetectedSvg(false)
          }
        }
      )
    return () => {
      active = false
    }
  }, [hintedSvg, uri])

  return hintedSvg ? true : detectedSvg
}

function RetryableSvgImage({
  onReady,
  refetch,
  transparentBackground = false,
  uri,
}: {
  onReady?: () => void
  refetch: () => Promise<unknown>
  transparentBackground?: boolean
  uri: string
}) {
  const { failed, handleError, revision } = useRetryableImage(refetch)
  const { colors } = useXGUITheme()
  const [xml, setXml] = useState<string | null>(
    () => getCachedAvatarSvg(uri) ?? null
  )
  useEffect(() => {
    if (failed) onReady?.()
  }, [failed, onReady])

  useEffect(() => {
    let active = true
    if (revision === 0 && getCachedAvatarSvg(uri)) return
    readSvgContent(uri).then(
      (content) => {
        if (active) {
          const normalized = normalizeAvatarSvgContent(content)
          setCachedAvatarSvg(uri, normalized)
          setXml(normalized)
        }
      },
      () => void handleError()
    )
    return () => {
      active = false
    }
  }, [handleError, revision, uri])

  if (failed) return null
  const image = xml ? (
    <SvgXml
      height="100%"
      key={revision}
      onError={() => void handleError()}
      onLayout={onReady}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      xml={xml}
    />
  ) : null

  if (!image) {
    return <AvatarImageSurface transparentBackground={transparentBackground} />
  }

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: transparentBackground
            ? "transparent"
            : colors.background1,
        },
      ]}
    >
      {image}
    </View>
  )
}

function AvatarImageSurface({
  transparentBackground = false,
}: {
  transparentBackground?: boolean
}) {
  const { colors } = useXGUITheme()
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: transparentBackground
            ? "transparent"
            : colors.background1,
        },
      ]}
    />
  )
}

async function readSvgContent(uri: string) {
  if (Platform.OS !== "web") return FileSystem.readAsStringAsync(uri)

  const response = await fetch(uri)
  if (!response.ok) {
    throw new Error(`Unable to load SVG avatar (${response.status})`)
  }
  return response.text()
}

function RetryableAvatarImage({
  refetch,
  uri,
}: {
  refetch: () => Promise<unknown>
  uri: string
}) {
  const { failed, handleError, revision } = useRetryableImage(refetch)
  const { colors } = useXGUITheme()

  return failed ? null : (
    <>
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: colors.background1 },
        ]}
      />
      <Avatar.Image
        key={revision}
        onError={() => void handleError()}
        src={uri}
      />
    </>
  )
}

function RetryableTileImage({
  onReady,
  refetch,
  uri,
}: {
  onReady?: () => void
  refetch: () => Promise<unknown>
  uri: string
}) {
  const { failed, handleError, revision } = useRetryableImage(refetch)
  useEffect(() => {
    if (failed) onReady?.()
  }, [failed, onReady])

  return failed ? null : (
    <View style={StyleSheet.absoluteFill}>
      <NativeImage
        fadeDuration={0}
        key={revision}
        onError={() => void handleError()}
        onLoad={onReady}
        resizeMode="cover"
        source={{ uri }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  )
}

function useRetryableImage(refetch: () => Promise<unknown>) {
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const mountedRef = useRef(true)
  const retryCountRef = useRef(0)
  const retryingRef = useRef(false)

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleError = useCallback(async () => {
    if (retryingRef.current || failed) return

    if (retryCountRef.current >= 1) {
      setFailed(true)
      return
    }

    retryCountRef.current += 1
    retryingRef.current = true

    try {
      await refetch()
      if (mountedRef.current) {
        setRevision((current) => current + 1)
      }
    } catch {
      if (mountedRef.current) {
        setFailed(true)
      }
    } finally {
      retryingRef.current = false
    }
  }, [failed, refetch])

  return { failed, handleError, revision }
}

export { isSvgUrl } from "@/components/avatar/avatar-resource-format"
