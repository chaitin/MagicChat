import { net } from "electron"
import { APP_VERSION, BUILD_ID } from "../shared/build-info"
import type { UpdateInfo } from "../shared/desktop"
import { fetchUpdateInfo } from "./update-check"
import { releasePlatform } from "./update-policy"

export { isTrustedReleaseUrl } from "./update-policy"

export function checkForUpdates(): Promise<UpdateInfo> {
  return fetchUpdateInfo({
    fetcher: (url, options) => net.fetch(url, options),
    platform: releasePlatform(process.platform, process.arch),
    currentVersion: APP_VERSION,
    currentBuildId: BUILD_ID,
  })
}
