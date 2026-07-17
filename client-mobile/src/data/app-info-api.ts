import {
  ApiRequestError,
  createApiClient,
  type ApiFetch,
} from "@/data/api-client"
import type { AppInfo } from "@/data/models"

type AppInfoResponse = {
  app_name?: string
  authenticated?: boolean
  email_code_login_enabled?: boolean
  organization_name?: string
  password_login_enabled?: boolean
}

export async function fetchAppInfo(
  serverUrl: string,
  options: { fetcher?: ApiFetch; signal?: AbortSignal } = {}
) {
  const data = await createApiClient(serverUrl, options.fetcher).request<
    AppInfoResponse
  >("/api/client/info", {
    errorMessage: "加载服务器信息失败",
    method: "GET",
    signal: options.signal,
  })
  const appName = data?.app_name?.trim()
  const organizationName = data?.organization_name?.trim()

  if (!appName || !organizationName) {
    throw new ApiRequestError("服务器信息响应格式不正确")
  }

  return {
    appName,
    authenticated: data?.authenticated === true,
    emailCodeLoginEnabled: data?.email_code_login_enabled === true,
    organizationName,
    passwordLoginEnabled: data?.password_login_enabled !== false,
  } satisfies AppInfo
}
