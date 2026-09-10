import { APIError, requestJSON } from "@/lib/api"

export async function checkSession() {
  try {
    await requestJSON<{ authenticated: boolean }>("/api/admin/v1/session")
    return true
  } catch (error) {
    if (error instanceof APIError && error.status === 401) return false
    return false
  }
}

export async function login(username: string, password: string) {
  if (!username.trim() || !password) throw new Error("请输入账号和密码")
  await requestJSON<{ authenticated: boolean }>("/api/admin/v1/session", {
    body: JSON.stringify({ password, username: username.trim() }),
    method: "POST",
  })
}

export async function logout() {
  try {
    await requestJSON<void>("/api/admin/v1/session", { method: "DELETE" })
  } catch {
    // The local authenticated state is still cleared when the session expired.
  }
}
