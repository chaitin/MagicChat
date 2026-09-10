import { useLocalSearchParams, useRouter } from "expo-router"
import { useCallback, useEffect, useMemo } from "react"

import { deleteMediaPickerRequest, getMediaPickerRequest } from "@/features/media-picker/media-picker-registry"
import { XGUIMediaPicker } from "@/xgui"

export default function MediaPickerRoute() {
  const router = useRouter()
  const { requestId } = useLocalSearchParams<{ requestId: string }>()
  const request = useMemo(() => getMediaPickerRequest(requestId), [requestId])
  const close = useCallback(() => { deleteMediaPickerRequest(requestId); router.back() }, [requestId, router])

  useEffect(() => () => {
    deleteMediaPickerRequest(requestId)
    request?.onClose?.()
  }, [request, requestId])
  useEffect(() => { if (!request) router.back() }, [request, router])

  if (!request) return null
  return <XGUIMediaPicker confirmLabel={request.confirmLabel} maxSelection={request.maxSelection} mediaKind={request.mediaKind} mode={request.mode} onCancel={close} onConfirm={async (assets) => { await request.onSelect(assets); deleteMediaPickerRequest(requestId); router.back() }} />
}
