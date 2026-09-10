import { useXGUIToast } from "@/xgui"
import { useCallback, useEffect, useRef, useState } from "react"

import type { PreparedClientMessageUpload } from "@/data/messages/message-upload"
import {
  MediaPermissionSettingsRequiredError,
  type MediaPermissionKind,
} from "@/features/permissions/media-permission"

type UploadPicker = () => Promise<PreparedClientMessageUpload | null>

export function useComposerUpload({
  disabled,
  onSend,
}: {
  disabled: boolean
  onSend: (selection: PreparedClientMessageUpload) => Promise<boolean>
}) {
  const toast = useXGUIToast()
  const mountedRef = useRef(true)
  const selectedRef = useRef<PreparedClientMessageUpload | null>(null)
  const uploadInFlightRef = useRef(false)
  const [preparing, setPreparing] = useState(false)
  const [permissionSettingsRequired, setPermissionSettingsRequired] =
    useState<MediaPermissionKind | null>(null)
  const [selected, setSelected] =
    useState<PreparedClientMessageUpload | null>(null)

  const releaseSelected = useCallback(() => {
    selectedRef.current = null
    if (mountedRef.current) setSelected(null)
  }, [])

  const replaceSelected = useCallback(
    (selection: PreparedClientMessageUpload | null) => {
      if (selectedRef.current !== selection) {
        selectedRef.current?.cleanup?.()
      }
      selectedRef.current = selection
      if (mountedRef.current) setSelected(selection)
    },
    []
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (!uploadInFlightRef.current) {
        selectedRef.current?.cleanup?.()
        selectedRef.current = null
      }
    }
  }, [])

  const pick = useCallback(
    async (picker: UploadPicker) => {
      setPreparing(true)

      try {
        const selection = await picker()
        if (selection) {
          if (mountedRef.current) replaceSelected(selection)
          else selection.cleanup?.()
        }
        return selection
      } catch (error: unknown) {
        if (error instanceof MediaPermissionSettingsRequiredError) {
          setPermissionSettingsRequired(error.kind)
        } else {
          toast.show({ message: `${"无法选择文件"}：${error instanceof Error ? error.message : "请稍后重试"}`, modal: false, type: "text", duration: 1_000 })
        }
        return null
      } finally {
        if (mountedRef.current) setPreparing(false)
      }
    },
    [replaceSelected, toast]
  )

  const confirm = useCallback(async () => {
    if (!selected || disabled || uploadInFlightRef.current) return false

    const selection = selected
    uploadInFlightRef.current = true
    try {
      const sent = await onSend(selection)
      // A successful enqueue transfers cleanup ownership to the optimistic send.
      // Keep the local URI alive for rendering and retries.
      if (sent) releaseSelected()
      return sent
    } finally {
      uploadInFlightRef.current = false
      if (!mountedRef.current && selectedRef.current === selection) {
        replaceSelected(null)
      }
    }
  }, [disabled, onSend, releaseSelected, replaceSelected, selected])

  const cancel = useCallback(() => replaceSelected(null), [replaceSelected])

  return {
    cancel,
    confirm,
    dismissPermissionSettings: () => setPermissionSettingsRequired(null),
    permissionSettingsRequired,
    pick,
    preparing,
    selected,
  }
}
