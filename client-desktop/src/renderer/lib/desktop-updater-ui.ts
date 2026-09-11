import { useCallback, useRef, useState } from "react"

import type { Translator } from "@/lib/i18n"
import type { UpdaterInstallResult, UpdaterState } from "@shared/bridge"

export function useDesktopUpdateAction(onError: (message: string) => void, t: Translator) {
  const [actionPending, setActionPending] = useState(false)
  const actionPendingRef = useRef(false)

  const runUpdateAction = useCallback(
    async (action: () => Promise<void>) => {
      if (actionPendingRef.current) return
      actionPendingRef.current = true
      setActionPending(true)
      try {
        await action()
      } catch {
        onError(t("settings.update.actionFailed"))
      } finally {
        actionPendingRef.current = false
        setActionPending(false)
      }
    },
    [onError, t],
  )

  return { actionPending, runUpdateAction }
}

export function updateStatusText(state: UpdaterState, t: Translator): string {
  if (state.status === "manual") return t("settings.update.status.manual")
  if (state.status === "unsupported") return t("settings.update.status.unsupported")
  if (state.status === "installing") return t("settings.update.status.installing")
  if (state.status === "downloading") {
    return state.progress === undefined
      ? t("settings.update.status.downloadingUnknown")
      : t("settings.update.status.downloading", { percent: Math.round(state.progress) })
  }
  if (state.status === "error") {
    return state.errorCode === "platform_signature_required"
      ? t("settings.update.status.signatureRequired")
      : t("settings.update.status.error", { code: state.errorCode ?? "unknown" })
  }
  if (state.status === "idle") return t("settings.update.status.idle")
  if (state.status === "checking") return t("settings.update.status.checking")
  if (state.status === "downloaded") return t("settings.update.status.downloaded")
  return t("settings.update.status.available", {
    version: state.targetVersion ?? t("settings.update.status.newVersion"),
  })
}

export function getUpdateInstallErrorMessage(
  reason: UpdaterInstallResult["reason"],
  t: Translator,
): string {
  if (reason === "install_failed") return t("settings.update.error.installFailed")
  if (reason === "active_transfers") return t("settings.update.error.activeTransfers")
  if (reason === "install_in_progress") return t("settings.update.error.installInProgress")
  if (reason === "not_downloaded") return t("settings.update.error.notDownloaded")
  return t("settings.update.error.prepareFailed")
}

export function installationSourceLabel(source: UpdaterState["installationSource"], t: Translator) {
  const labels: Record<UpdaterState["installationSource"], string> = {
    appimage: "Linux AppImage",
    deb: "Linux deb",
    development: t("settings.update.source.development"),
    mac_app: t("settings.update.source.macApp"),
    nsis: "Windows NSIS",
    unknown: t("settings.update.source.unknown"),
  }
  return labels[source]
}
