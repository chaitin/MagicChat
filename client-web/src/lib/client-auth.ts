type ClientAuthFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

type ClientLoginInput = {
  account: string
  password: string
}

type ClientUserResponse = {
  email?: string
  id?: string
  name?: string
}

type ClientLoginSuccessEnvelope = {
  data?: {
    user?: ClientUserResponse
  }
  success?: boolean
}

type ClientLoginErrorEnvelope = {
  error?: {
    code?: string
    message?: string
  }
  success?: boolean
}

export type ClientUser = {
  email: string
  id: string
  name: string
}

export class ClientLoginRequestError extends Error {
  code?: string

  constructor(message: string, options?: { code?: string }) {
    super(message)
    this.name = "ClientLoginRequestError"
    this.code = options?.code
  }
}

export class ClientLogoutRequestError extends Error {
  code?: string

  constructor(message: string, options?: { code?: string }) {
    super(message)
    this.name = "ClientLogoutRequestError"
    this.code = options?.code
  }
}

export async function clientLogin(
  input: ClientLoginInput,
  fetcher: ClientAuthFetch = fetch
) {
  const response = await fetcher("/api/client/auth/login", {
    body: JSON.stringify({
      email: input.account.trim(),
      password: input.password,
    }),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
  const payload = await readJson<
    ClientLoginErrorEnvelope | ClientLoginSuccessEnvelope
  >(response)

  if (!response.ok || payload?.success === false) {
    const error = (payload as ClientLoginErrorEnvelope | undefined)?.error
    throw new ClientLoginRequestError(
      error?.message ?? `登录失败（HTTP ${response.status}）`,
      {
        code: error?.code,
      }
    )
  }

  const user = (payload as ClientLoginSuccessEnvelope | undefined)?.data?.user

  if (!user?.email || !user.id || !user.name) {
    throw new ClientLoginRequestError("登录响应格式不正确")
  }

  return {
    email: user.email,
    id: user.id,
    name: user.name,
  }
}

export async function clientLogout(fetcher: ClientAuthFetch = fetch) {
  const response = await fetcher("/api/client/auth/logout", {
    credentials: "include",
    method: "POST",
  })
  const payload = await readJson<ClientLoginErrorEnvelope>(response)

  if (!response.ok || payload?.success === false) {
    const error = payload?.error
    throw new ClientLogoutRequestError(
      error?.message ?? `退出登录失败（HTTP ${response.status}）`,
      {
        code: error?.code,
      }
    )
  }
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  const contentType = response.headers.get("content-type")

  if (!contentType?.includes("application/json")) {
    return undefined
  }

  return response.json() as Promise<T>
}
