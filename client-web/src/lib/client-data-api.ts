type ClientDataFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

type ClientDataSuccessEnvelope<T> = {
  data?: T
  success?: boolean
}

type ClientDataErrorEnvelope = {
  error?: {
    code?: string
    message?: string
  }
  success?: boolean
}

type ClientUserResponse = {
  avatar?: string
  created_at?: string
  email?: string
  id?: string
  name?: string
  nickname?: string
  phone?: string
  status?: string
}

type CurrentClientUserResponse = {
  user?: ClientUserResponse
}

type UpdateCurrentClientUserInput = {
  avatar?: string
  nickname?: string
}

type ContactUserResponse = {
  avatar?: string
  email?: string
  id?: string
  name?: string
  nickname?: string
  phone?: string
  type?: string
}

type ListClientContactsResponse = {
  contacts?: ContactUserResponse[]
}

export type ClientUser = {
  avatar: string
  createdAt: string
  email: string
  id: string
  name: string
  nickname: string
  phone: string
  status: "active" | "disabled"
}

export type ContactUser = {
  avatar: string
  email: string
  id: string
  name: string
  nickname: string
  phone: string
  type: "user"
}

export class ClientDataRequestError extends Error {
  code?: string
  status?: number

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message)
    this.name = "ClientDataRequestError"
    this.code = options?.code
    this.status = options?.status
  }
}

export async function getCurrentClientUser(fetcher: ClientDataFetch = fetch) {
  const response = await fetcher("/api/client/me", {
    credentials: "include",
    method: "GET",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<CurrentClientUserResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载当前用户失败")
  }

  const user = (
    payload as ClientDataSuccessEnvelope<CurrentClientUserResponse> | undefined
  )?.data?.user

  return normalizeClientUser(user)
}

export async function updateCurrentClientUser(
  input: UpdateCurrentClientUserInput,
  fetcher: ClientDataFetch = fetch
) {
  const response = await fetcher("/api/client/me", {
    body: JSON.stringify(input),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<CurrentClientUserResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "更新个人信息失败")
  }

  const user = (
    payload as ClientDataSuccessEnvelope<CurrentClientUserResponse> | undefined
  )?.data?.user

  return normalizeClientUser(user)
}

export async function listClientContacts(fetcher: ClientDataFetch = fetch) {
  const response = await fetcher("/api/client/contacts/users", {
    credentials: "include",
    method: "GET",
  })
  const payload = await readJson<
    | ClientDataErrorEnvelope
    | ClientDataSuccessEnvelope<ListClientContactsResponse>
  >(response)

  if (!response.ok || payload?.success === false) {
    throw createRequestError(payload, response, "加载通讯录失败")
  }

  const contacts = (
    payload as ClientDataSuccessEnvelope<ListClientContactsResponse> | undefined
  )?.data?.contacts

  if (!contacts) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
  }

  return contacts.map(normalizeContactUser)
}

function normalizeClientUser(user: ClientUserResponse | undefined): ClientUser {
  if (!user?.created_at || !user.email || !user.id || !user.name) {
    throw new ClientDataRequestError("当前用户响应格式不正确")
  }

  return {
    avatar: user.avatar ?? "",
    createdAt: user.created_at,
    email: user.email,
    id: user.id,
    name: user.name,
    nickname: user.nickname ?? "",
    phone: user.phone ?? "",
    status: user.status === "disabled" ? "disabled" : "active",
  }
}

function normalizeContactUser(
  contact: ContactUserResponse | undefined
): ContactUser {
  if (!contact?.email || !contact.id || !contact.name) {
    throw new ClientDataRequestError("通讯录响应格式不正确")
  }

  return {
    avatar: contact.avatar ?? "",
    email: contact.email,
    id: contact.id,
    name: contact.name,
    nickname: contact.nickname ?? "",
    phone: contact.phone ?? "",
    type: "user",
  }
}

function createRequestError(
  payload:
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<unknown> | undefined,
  response: Response,
  fallbackMessage: string
) {
  const error = (payload as ClientDataErrorEnvelope | undefined)?.error

  return new ClientDataRequestError(
    error?.message ?? `${fallbackMessage}（HTTP ${response.status}）`,
    {
      code: error?.code,
      status: response.status,
    }
  )
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  const contentType = response.headers.get("content-type")

  if (!contentType?.includes("application/json")) {
    return undefined
  }

  return response.json() as Promise<T>
}
