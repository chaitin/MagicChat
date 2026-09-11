import { ClientDataRequestError } from "@/lib/client-data-api"

type DocumentDataFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

type SuccessEnvelope<T> = { data?: T; success?: boolean }
type ErrorEnvelope = {
  error?: { code?: string; message?: string }
  success?: boolean
}

type DocumentUserResponse = {
  avatar?: string
  id?: string
  name?: string
  nickname?: string
}

type DocumentResponse = {
  contributor_count?: number
  contributors?: DocumentUserResponse[]
  created_at?: string
  creator?: DocumentUserResponse
  document_type?: string | null
  id?: string
  kind?: string
  parent_id?: string | null
  project_id?: string
  schema_version?: number
  sort_order?: number
  title?: string
  updated_at?: string
  updated_by?: DocumentUserResponse
}

type DocumentListResponse = { documents?: DocumentResponse[] }
type DeleteDocumentResponse = {
  deleted_count?: number
  document_id?: string
}

type CollaborativeTitleResponse = {
  document_id?: string
  title?: string
}

export type ClientDocumentKind = "document" | "folder"
export type ClientDocumentType = "document" | "markdown"

export type ClientDocumentUser = {
  avatar: string
  id: string
  name: string
  nickname: string
}

export type ClientDocument = {
  contributorCount: number
  contributors: ClientDocumentUser[]
  createdAt: string
  creator: ClientDocumentUser
  documentType: ClientDocumentType | null
  id: string
  kind: ClientDocumentKind
  parentId: string | null
  projectId: string
  schemaVersion: number
  sortOrder: number
  title: string
  updatedAt: string
  updatedBy: ClientDocumentUser
}

export type CreateClientDocumentInput =
  | {
      documentType?: ClientDocumentType
      kind: "document"
      parentId?: string | null
      title: string
    }
  | {
      kind: "folder"
      parentId?: string | null
      title: string
    }

export type UpdateClientDocumentInput = {
  parentId?: string | null
  sortOrder?: number
  title?: string
}

export type MoveClientDocumentInput = {
  index: number
  parentId: string | null
}

export async function listClientDocuments(
  projectId: string,
  fetcher: DocumentDataFetch = fetch
): Promise<ClientDocument[]> {
  const payload = await request<DocumentListResponse>(
    `/api/client/projects/${encodeURIComponent(projectId)}/documents`,
    { credentials: "include", method: "GET" },
    "加载文档列表失败",
    fetcher
  )
  if (!Array.isArray(payload.documents)) {
    throw new ClientDataRequestError("文档列表响应格式不正确")
  }
  return payload.documents.map(normalizeDocument)
}

export async function createClientDocument(
  projectId: string,
  input: CreateClientDocumentInput,
  fetcher: DocumentDataFetch = fetch
): Promise<ClientDocument> {
  return normalizeDocument(
    await request<DocumentResponse>(
      `/api/client/projects/${encodeURIComponent(projectId)}/documents`,
      jsonRequest("POST", {
        ...(input.kind === "document"
          ? { document_type: input.documentType ?? "document" }
          : {}),
        kind: input.kind,
        parent_id: input.parentId ?? null,
        title: input.title,
      }),
      "创建文档失败",
      fetcher
    )
  )
}

export async function getClientDocument(
  documentId: string,
  fetcher: DocumentDataFetch = fetch
): Promise<ClientDocument> {
  return normalizeDocument(
    await request<DocumentResponse>(
      `/api/client/documents/${encodeURIComponent(documentId)}`,
      { credentials: "include", method: "GET" },
      "加载文档失败",
      fetcher
    )
  )
}

export async function updateClientDocument(
  documentId: string,
  input: UpdateClientDocumentInput,
  fetcher: DocumentDataFetch = fetch
): Promise<ClientDocument> {
  const body: Record<string, unknown> = {}
  if (input.title !== undefined) body.title = input.title
  if (input.parentId !== undefined) body.parent_id = input.parentId
  if (input.sortOrder !== undefined) body.sort_order = input.sortOrder
  return normalizeDocument(
    await request<DocumentResponse>(
      `/api/client/documents/${encodeURIComponent(documentId)}`,
      jsonRequest("PATCH", body),
      "更新文档失败",
      fetcher
    )
  )
}

export async function moveClientDocument(
  documentId: string,
  input: MoveClientDocumentInput,
  fetcher: DocumentDataFetch = fetch
): Promise<ClientDocument> {
  return normalizeDocument(
    await request<DocumentResponse>(
      `/api/client/documents/${encodeURIComponent(documentId)}/move`,
      jsonRequest("POST", {
        index: input.index,
        parent_id: input.parentId,
      }),
      "移动文档失败",
      fetcher
    )
  )
}

export async function updateCollaborativeDocumentTitle(
  documentId: string,
  title: string,
  fetcher: DocumentDataFetch = fetch
): Promise<string> {
  const data = await request<CollaborativeTitleResponse>(
    `/api/client/document/collaboration/${encodeURIComponent(documentId)}/title`,
    {
      ...jsonRequest("PATCH", { title }),
      keepalive: true,
    },
    "保存文档标题失败",
    fetcher
  )
  if (data.document_id !== documentId || typeof data.title !== "string") {
    throw new ClientDataRequestError("文档标题响应格式不正确")
  }
  return data.title
}

export async function deleteClientDocument(
  documentId: string,
  fetcher: DocumentDataFetch = fetch
): Promise<{ deletedCount: number; documentId: string }> {
  const data = await request<DeleteDocumentResponse>(
    `/api/client/documents/${encodeURIComponent(documentId)}`,
    { credentials: "include", method: "DELETE" },
    "删除文档失败",
    fetcher
  )
  if (
    typeof data.document_id !== "string" ||
    typeof data.deleted_count !== "number"
  ) {
    throw new ClientDataRequestError("删除文档响应格式不正确")
  }
  return { deletedCount: data.deleted_count, documentId: data.document_id }
}

function jsonRequest(method: "PATCH" | "POST", body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method,
  }
}

async function request<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string,
  fetcher: DocumentDataFetch
): Promise<T> {
  const response = await fetcher(path, init)
  const payload = await readJson<ErrorEnvelope | SuccessEnvelope<T>>(response)
  if (!response.ok || payload?.success === false) {
    const message = (payload as ErrorEnvelope | undefined)?.error?.message
    throw new ClientDataRequestError(message?.trim() || fallbackMessage, {
      code: (payload as ErrorEnvelope | undefined)?.error?.code,
      status: response.status,
    })
  }
  const data = (payload as SuccessEnvelope<T> | undefined)?.data
  if (!data)
    throw new ClientDataRequestError(`${fallbackMessage}：响应格式不正确`)
  return data
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T
  } catch {
    return undefined
  }
}

export function getClientDocumentPath(
  documentId: string,
  documentType: ClientDocumentType | null
) {
  if (!documentType) throw new Error("文档类型不存在")
  return `/documents/${documentType}/${encodeURIComponent(documentId)}`
}

function normalizeDocument(value: DocumentResponse): ClientDocument {
  if (
    typeof value.id !== "string" ||
    typeof value.project_id !== "string" ||
    (value.kind !== "document" && value.kind !== "folder") ||
    typeof value.title !== "string" ||
    typeof value.sort_order !== "number" ||
    typeof value.schema_version !== "number" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    (value.parent_id !== null &&
      value.parent_id !== undefined &&
      typeof value.parent_id !== "string") ||
    !value.creator ||
    !value.updated_by
  ) {
    throw new ClientDataRequestError("文档响应格式不正确")
  }
  const documentType: ClientDocumentType | null =
    value.document_type === "document" || value.document_type === "markdown"
      ? value.document_type
      : null
  if (
    (value.kind === "document" && documentType === null) ||
    (value.kind === "folder" && value.document_type != null)
  ) {
    throw new ClientDataRequestError("文档类型响应格式不正确")
  }
  const creator = normalizeUser(value.creator)
  const updatedBy = normalizeUser(value.updated_by)
  const contributors = Array.isArray(value.contributors)
    ? value.contributors.map(normalizeUser)
    : uniqueUsers([creator, updatedBy])
  return {
    contributorCount:
      typeof value.contributor_count === "number" &&
      Number.isInteger(value.contributor_count) &&
      value.contributor_count >= contributors.length
        ? value.contributor_count
        : contributors.length,
    contributors,
    createdAt: value.created_at,
    creator,
    documentType,
    id: value.id,
    kind: value.kind,
    parentId: value.parent_id ?? null,
    projectId: value.project_id,
    schemaVersion: value.schema_version,
    sortOrder: value.sort_order,
    title: value.title,
    updatedAt: value.updated_at,
    updatedBy,
  }
}

function uniqueUsers(users: ClientDocumentUser[]) {
  return Array.from(new Map(users.map((user) => [user.id, user])).values())
}

function normalizeUser(value: DocumentUserResponse): ClientDocumentUser {
  if (typeof value.id !== "string") {
    throw new ClientDataRequestError("文档用户响应格式不正确")
  }
  return {
    avatar: typeof value.avatar === "string" ? value.avatar : "",
    id: value.id,
    name: typeof value.name === "string" ? value.name : "",
    nickname: typeof value.nickname === "string" ? value.nickname : "",
  }
}
