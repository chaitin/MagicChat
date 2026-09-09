const AUTH_SESSION_KEY = "magicchat.push-gateway.admin-session.demo"

export function isAuthenticated() {
  return localStorage.getItem(AUTH_SESSION_KEY) === "authenticated"
}

export async function login(account: string, password: string) {
  await new Promise((resolve) => setTimeout(resolve, 450))
  if (!account.trim() || !password) {
    throw new Error("请输入账号和密码")
  }
  localStorage.setItem(AUTH_SESSION_KEY, "authenticated")
}

export function logout() {
  localStorage.removeItem(AUTH_SESSION_KEY)
}
