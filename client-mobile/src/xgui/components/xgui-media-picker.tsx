import { ChevronDown, Play, X } from "lucide-react-native"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import * as MediaLibrary from "expo-media-library/legacy"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Image as ExpoImage } from "expo-image"
import { useVideoPlayer, type VideoThumbnail } from "expo-video"

import { MediaPermissionSettingsDialog } from "@/components/permissions/media-permission-settings-dialog"
import { XGUIActionSheet } from "@/xgui/components/xgui-action-sheet"
import { XGUIButton } from "@/xgui/components/xgui-button"
import { useXGUIToast } from "@/xgui/components/xgui-toast"
import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

const PAGE_SIZE = 80
const GAP = 2

export type XGUIMediaPickerProps = {
  confirmLabel: string
  maxSelection?: number
  mediaKind?: "mixed" | "photo" | "video"
  mode: "single" | "multiple"
  onCancel: () => void
  onConfirm: (assets: MediaLibrary.Asset[]) => void | Promise<void>
}

export function XGUIMediaPicker({
  confirmLabel,
  maxSelection = 9,
  mediaKind = "photo",
  mode,
  onCancel,
  onConfirm,
}: XGUIMediaPickerProps) {
  const insets = useSafeAreaInsets()
  const toast = useXGUIToast()
  const { colors } = useXGUITheme()
  const { height, width } = useWindowDimensions()
  const itemSize = Math.floor((width - GAP * 3) / 4)
  const [permission, requestPermission] = MediaLibrary.usePermissions({
    granularPermissions:
      mediaKind === "mixed" ? ["photo", "video"] : [mediaKind],
  })
  const usesAndroidGranularPermission =
    Platform.OS === "android" &&
    Platform.Version >= 33 &&
    mediaKind !== "photo"
  const [androidPermissionGranted, setAndroidPermissionGranted] =
    useState<boolean>()
  const hasPermission = usesAndroidGranularPermission
    ? androidPermissionGranted
    : permission?.granted
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([])
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([])
  const [album, setAlbum] = useState<MediaLibrary.Album>()
  const [after, setAfter] = useState<string>()
  const [hasNextPage, setHasNextPage] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<MediaLibrary.Asset[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [albumSheetOpen, setAlbumSheetOpen] = useState(false)
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false)
  const permissionAttemptedRef = useRef(false)

  useEffect(() => {
    if (
      usesAndroidGranularPermission ||
      !permission ||
      permission.granted ||
      permissionAttemptedRef.current
    ) return
    permissionAttemptedRef.current = true

    if (!permission.canAskAgain) {
      const timer = setTimeout(() => setPermissionDialogOpen(true), 0)
      return () => clearTimeout(timer)
    }

    void requestPermission()
      .then((response) => {
        if (!response.granted) onCancel()
      })
      .catch((cause: unknown) => {
        toast.show({
          message: cause instanceof Error ? cause.message : "无法申请照片访问权限",
          modal: false,
          type: "error",
        })
        onCancel()
      })
  }, [onCancel, permission, requestPermission, toast, usesAndroidGranularPermission])

  useEffect(() => {
    if (!usesAndroidGranularPermission || permissionAttemptedRef.current) return
    permissionAttemptedRef.current = true
    let active = true
    const requestedPermissions =
      mediaKind === "mixed"
        ? [
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
          ]
        : [PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO]

    void Promise.all(
      requestedPermissions.map((item) => PermissionsAndroid.check(item))
    )
      .then(async (grants) => {
        if (!active) return
        const missing = requestedPermissions.filter((_, index) => !grants[index])
        const results = missing.length
          ? await PermissionsAndroid.requestMultiple(missing)
          : {}
        if (!active) return

        const currentGrants = await Promise.all(
          requestedPermissions.map((item) => PermissionsAndroid.check(item))
        )
        const limited =
          Number(Platform.Version) >= 34 &&
          (await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_VISUAL_USER_SELECTED
          ))
        if (!active) return
        if (currentGrants.some(Boolean) || limited) {
          setAndroidPermissionGranted(true)
        } else if (
          Object.values(results).includes(
            PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
          )
        ) {
          setPermissionDialogOpen(true)
        } else {
          onCancel()
        }
      })
      .catch((cause: unknown) => {
        if (!active) return
        toast.show({
          message:
            cause instanceof Error ? cause.message : "无法申请媒体访问权限",
          modal: false,
          type: "error",
        })
        onCancel()
      })

    return () => {
      active = false
    }
  }, [mediaKind, onCancel, toast, usesAndroidGranularPermission])

  const load = useCallback(async (reset: boolean, targetAlbum?: MediaLibrary.Album) => {
    if (loading || (!reset && !hasNextPage)) return
    setLoading(true)
    setError("")
    try {
      const page = await MediaLibrary.getAssetsAsync({
        after: reset ? undefined : after,
        album: targetAlbum,
        first: PAGE_SIZE,
        mediaType:
          mediaKind === "mixed"
            ? [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video]
            : [
                mediaKind === "video"
                  ? MediaLibrary.MediaType.video
                  : MediaLibrary.MediaType.photo,
              ],
        sortBy: [MediaLibrary.SortBy.creationTime],
      })
      setAssets((current) => reset ? page.assets : [...current, ...page.assets])
      setAfter(page.endCursor)
      setHasNextPage(page.hasNextPage)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "相册加载失败")
    } finally {
      setLoading(false)
    }
  }, [after, hasNextPage, loading, mediaKind])

  useEffect(() => {
    if (!hasPermission) return
    const timer = setTimeout(() => void Promise.all([
      MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true }).then(setAlbums),
      load(true),
    ]), 0)
    return () => clearTimeout(timer)
    // Initial permission transition only; pagination state must not restart this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission])

  const select = useCallback((asset: MediaLibrary.Asset) => {
    setSelected((current) => {
      const index = current.findIndex((item) => item.id === asset.id)
      if (index >= 0) return current.filter((item) => item.id !== asset.id)
      if (mode === "single") return [asset]
      if (current.length >= maxSelection) {
        toast.show({
          duration: 1_000,
          message:
            mediaKind === "video"
              ? `最多选择 ${maxSelection} 个视频`
              : `最多选择 ${maxSelection} 张图片`,
          modal: false,
          type: "text",
        })
        return current
      }
      return [...current, asset]
    })
  }, [maxSelection, mediaKind, mode, toast])

  const submit = useCallback(async () => {
    if (submitting || selected.length === 0) return
    setSubmitting(true)
    try {
      await onConfirm(selected)
    } catch (cause: unknown) {
      toast.show({
        duration: 1_000,
        message:
          cause instanceof Error
            ? cause.message
            : mediaKind === "video"
              ? "视频选择失败"
              : mediaKind === "mixed"
                ? "媒体选择失败"
                : "图片发送失败",
        modal: false, type: "error",
      })
    } finally {
      setSubmitting(false)
    }
  }, [mediaKind, onConfirm, selected, submitting, toast])

  const allMediaLabel = mediaKind === "video" ? "所有视频" : "最近项目"
  const actions = useMemo(() => [
    { label: allMediaLabel, onPress: () => { setAlbum(undefined); void load(true) } },
    ...albums.filter((item) => item.assetCount > 0).map((item) => ({
      label: `${item.title} (${item.assetCount})`,
      onPress: () => { setAlbum(item); void load(true, item) },
    })),
  ], [albums, allMediaLabel, load])

  if (permissionDialogOpen || !hasPermission) {
    return (
      <View style={styles.root}>
        {!permissionDialogOpen ? (
          <View style={styles.permissionLoading}>
            <ActivityIndicator color="#aaa" />
            <Text style={styles.stateText}>
              {mediaKind === "video"
                ? "正在请求视频访问权限"
                : mediaKind === "mixed"
                  ? "正在请求照片和视频访问权限"
                  : "正在请求照片访问权限"}
            </Text>
          </View>
        ) : null}
        <MediaPermissionSettingsDialog
          kind={permissionDialogOpen ? "photos" : null}
          onCancel={onCancel}
        />
      </View>
    )
  }

  const confirmation = mode === "multiple" && selected.length ? `${confirmLabel}(${selected.length})` : confirmLabel
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <Pressable accessibilityLabel={mediaKind === "mixed" ? "关闭媒体选择" : mediaKind === "video" ? "关闭视频选择" : "关闭图片选择"} disabled={submitting} hitSlop={12} onPress={onCancel}><X color="#fff" size={27} /></Pressable>
        <Pressable accessibilityLabel="切换相册" onPress={() => setAlbumSheetOpen(true)} style={styles.albumButton}>
          <Text numberOfLines={1} style={styles.albumTitle}>{album?.title ?? allMediaLabel}</Text><ChevronDown color="#fff" size={16} />
        </Pressable>
        <XGUIButton
          accessibilityLabel={confirmation}
          disabled={!selected.length || submitting}
          loading={submitting}
          onPress={() => void submit()}
          size="mini"
          style={styles.confirmButton}
          textStyle={styles.confirmButtonText}
        >
          {confirmation}
        </XGUIButton>
      </View>
      <FlatList
        columnWrapperStyle={styles.row}
        data={assets}
        initialNumToRender={24}
        keyExtractor={(item) => item.id}
        maxToRenderPerBatch={32}
        numColumns={4}
        onEndReached={() => void load(false, album)}
        onEndReachedThreshold={0.7}
        removeClippedSubviews
        renderItem={({ item }) => {
          const index = selected.findIndex((asset) => asset.id === item.id)
          return (
            <Pressable accessibilityLabel={`${item.filename}${index >= 0 ? `，已选择，第${index + 1}项` : "，未选择"}`} accessibilityRole="button" disabled={submitting} onPress={() => select(item)} style={{ height: itemSize, width: itemSize }}>
              {item.mediaType === MediaLibrary.MediaType.video ? (
                <VideoAssetThumbnail asset={item} />
              ) : (
                <Image source={{ uri: item.uri }} style={styles.image} />
              )}
              <View
                style={[
                  styles.selection,
                  index >= 0 && {
                    backgroundColor: colors.brand,
                    borderColor: colors.brand,
                  },
                ]}
              >
                {index >= 0 ? (
                  <Text style={styles.selectionText}>
                    {mode === "multiple" ? index + 1 : "✓"}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          )
        }}
        ListEmptyComponent={!loading ? <View style={styles.empty}><Text style={styles.stateText}>{error || (mediaKind === "video" ? "此相册没有视频" : mediaKind === "mixed" ? "此相册没有照片或视频" : "此相册没有图片")}</Text>{error ? <Pressable onPress={() => void load(true, album)}><Text style={styles.link}>重试</Text></Pressable> : null}</View> : null}
        windowSize={7}
      />
      <XGUIActionSheet
        actions={actions}
        maxContentHeight={Math.round(height * 0.7)}
        onOpenChange={setAlbumSheetOpen}
        open={albumSheetOpen}
        title="选择相册"
      />
    </View>
  )
}

function VideoAssetThumbnail({ asset }: { asset: MediaLibrary.Asset }) {
  const [failed, setFailed] = useState(false)
  const [sourceURI, setSourceURI] = useState<string | null>(null)
  const [thumbnail, setThumbnail] = useState<VideoThumbnail | null>(null)
  const player = useVideoPlayer(sourceURI)

  useEffect(() => {
    let active = true
    void MediaLibrary.getAssetInfoAsync(asset)
      .then((info) => {
        if (active) setSourceURI(info.localUri ?? info.uri)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [asset])

  useEffect(() => {
    if (!sourceURI) return
    let active = true
    void player
      .generateThumbnailsAsync(0, { maxWidth: 320 })
      .then(([value]) => {
        if (active && value) setThumbnail(value)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [player, sourceURI])

  return (
    <View style={styles.videoThumbnail}>
      {thumbnail ? (
        <ExpoImage contentFit="cover" source={thumbnail} style={styles.image} />
      ) : !failed ? (
        <ActivityIndicator color="#aaa" />
      ) : null}
      <View style={styles.videoPlayIcon}>
        <Play color="#fff" fill="#fff" size={18} />
      </View>
      <Text style={styles.videoDuration}>{formatDuration(asset.duration)}</Text>
    </View>
  )
}

function formatDuration(durationSeconds: number) {
  const duration = Math.max(0, Math.floor(durationSeconds))
  const minutes = Math.floor(duration / 60)
  return `${minutes}:${String(duration % 60).padStart(2, "0")}`
}

const styles = StyleSheet.create({
  albumButton: { alignItems: "center", backgroundColor: "#292929", borderRadius: 18, flexDirection: "row", gap: 4, maxWidth: "55%", paddingHorizontal: 14, paddingVertical: 8 },
  albumTitle: { color: "#fff", fontSize: 15, fontWeight: "600" }, center: { alignItems: "center", justifyContent: "center", padding: 28 },
  confirmButton: { height: 32, minWidth: 64 }, confirmButtonText: { fontSize: 15, lineHeight: 20 }, empty: { alignItems: "center", paddingTop: 80, width: "100%" },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 56, paddingBottom: 10, paddingHorizontal: 16 }, image: { height: "100%", width: "100%" },
  link: { color: "#35d6c5", fontSize: 15, marginTop: 18 }, permissionLoading: { alignItems: "center", flex: 1, gap: 12, justifyContent: "center" }, permissionButton: { backgroundColor: "#35d6c5", borderRadius: 8, marginTop: 24, paddingHorizontal: 24, paddingVertical: 12 }, permissionButtonText: { color: "#06100f", fontWeight: "700" }, permissionError: { color: "#fa5151", marginTop: 12, textAlign: "center" },
  root: { backgroundColor: "#080808", flex: 1 }, row: { gap: GAP, marginBottom: GAP }, selection: { alignItems: "center", backgroundColor: "rgba(0,0,0,.25)", borderColor: "#fff", borderRadius: 12, borderWidth: 1, bottom: 7, height: 24, justifyContent: "center", position: "absolute", right: 7, width: 24 }, selectionText: { color: "#fff", fontSize: 13, fontWeight: "700" }, stateText: { color: "#aaa", marginTop: 8, textAlign: "center" }, stateTitle: { color: "#fff", fontSize: 18, fontWeight: "600" },
  videoDuration: { backgroundColor: "rgba(0,0,0,.58)", borderRadius: 3, bottom: 5, color: "#fff", fontSize: 11, left: 5, overflow: "hidden", paddingHorizontal: 4, paddingVertical: 2, position: "absolute" },
  videoPlayIcon: { alignItems: "center", backgroundColor: "rgba(0,0,0,.4)", borderRadius: 18, height: 36, justifyContent: "center", left: "50%", marginLeft: -18, marginTop: -18, position: "absolute", top: "50%", width: 36 },
  videoThumbnail: { alignItems: "center", backgroundColor: "#1f1f1f", height: "100%", justifyContent: "center", width: "100%" },
})
