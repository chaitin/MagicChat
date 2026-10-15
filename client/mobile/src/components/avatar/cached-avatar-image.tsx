import { useCallback, useEffect, useRef, useState } from "react"
import * as FileSystem from "expo-file-system/legacy"
import { Image as NativeImage, Platform, StyleSheet, View } from "react-native"
import { SvgXml } from "react-native-svg"

import {
  getAvatarFormatHint,
  isSvgContent,
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
  const { refetch, sourceUrl, uri } = useCachedAvatar(server, avatar)

  return uri ? (
    <CachedAvatarResource
      key={`${sourceUrl}:${uri}`}
      refetch={refetch}
      sourceUrl={sourceUrl}
      uri={uri}
    />
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
  const { isLoading, refetch, sourceUrl, uri } = useCachedAvatar(
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
  const [verifyRasterHint, setVerifyRasterHint] = useState(false)
  const svg = useSvgResourceDetection(sourceUrl, uri, verifyRasterHint)
  const retryRaster = useCallback(async () => {
    if (!verifyRasterHint && getAvatarFormatHint(sourceUrl, uri) === false && getCachedAvatarFormat(uri) === undefined) {
      setVerifyRasterHint(true)
      return
    }
    await refetch()
  }, [refetch, sourceUrl, uri, verifyRasterHint])

  if (svg === null) return null
  if (svg) return (
    <RetryableSvgImage
      onReady={onReady}
      refetch={refetch}
      transparentBackground={tile}
      uri={uri}
    />
  )
  return tile ? (
    <RetryableTileImage onReady={onReady} refetch={retryRaster} uri={uri} />
  ) : (
    <RetryableAvatarImage refetch={retryRaster} uri={uri} />
  )
}

function useSvgResourceDetection(sourceUrl: string, uri: string, verifyHint: boolean) {
  const hintedFormat = verifyHint ? undefined : getAvatarFormatHint(sourceUrl, uri)
  const [detectedSvg, setDetectedSvg] = useState<boolean | null>(() => getCachedAvatarFormat(uri) ?? null)

  useEffect(() => {
    if (hintedFormat !== undefined || Platform.OS === "web" || detectedSvg !== null) return
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
  }, [detectedSvg, hintedFormat, uri])

  return detectedSvg ?? hintedFormat ?? (Platform.OS === "web" ? false : null)
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

  if (!image) return null

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
  const [loadedRevision, setLoadedRevision] = useState(-1)

  return failed ? null : (
    <NativeImage
      fadeDuration={0}
      key={revision}
      onError={() => void handleError()}
      onLoad={() => setLoadedRevision(revision)}
      resizeMode="cover"
      source={{ uri }}
      style={[
        StyleSheet.absoluteFill,
        loadedRevision === revision ? { backgroundColor: colors.background1 } : undefined,
      ]}
    />
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
