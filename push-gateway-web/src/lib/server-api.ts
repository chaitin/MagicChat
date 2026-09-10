import { requestJSON } from "@/lib/api"
import type {
  IssuedServerKey,
  PushServer,
  PushServerDraft,
  PushServerStatus,
} from "@/lib/server-model"

type ServerResponse = {
  created_at: string
  daily_quota: number
  id: string
  name: string
  revision: number
  status: PushServerStatus
  today_usage: number
}

type IssuedServerResponse = {
  key: string
  server: ServerResponse
}

export async function listServers() {
  const response = await requestJSON<{ servers: ServerResponse[] }>(
    "/api/admin/v1/servers"
  )
  return response.servers.map(normalizeServer)
}

export async function createServer(draft: PushServerDraft) {
  const response = await requestJSON<IssuedServerResponse>(
    "/api/admin/v1/servers",
    { body: encodeDraft(draft), method: "POST" }
  )
  return normalizeIssuedServer(response)
}

export async function updateServer(id: string, draft: PushServerDraft) {
  const response = await requestJSON<ServerResponse>(
    `/api/admin/v1/servers/${encodeURIComponent(id)}`,
    { body: encodeDraft(draft), method: "PATCH" }
  )
  return normalizeServer(response)
}

export async function setServerStatus(id: string, status: PushServerStatus) {
  const action = status === "active" ? "enable" : "disable"
  const response = await requestJSON<ServerResponse>(
    `/api/admin/v1/servers/${encodeURIComponent(id)}/${action}`,
    { method: "POST" }
  )
  return normalizeServer(response)
}

export async function revealServerKey(id: string) {
  return requestJSON<{ key: string }>(
    `/api/admin/v1/servers/${encodeURIComponent(id)}/key/reveal`,
    { method: "POST" }
  )
}

export async function rotateServerKey(id: string) {
  const response = await requestJSON<IssuedServerResponse>(
    `/api/admin/v1/servers/${encodeURIComponent(id)}/key/rotate`,
    { method: "POST" }
  )
  return normalizeIssuedServer(response)
}

function encodeDraft(draft: PushServerDraft) {
  return JSON.stringify({ daily_quota: draft.dailyLimit, name: draft.name })
}

function normalizeServer(server: ServerResponse): PushServer {
  return {
    createdAt: server.created_at,
    dailyLimit: server.daily_quota,
    id: server.id,
    name: server.name,
    revision: server.revision,
    status: server.status,
    todayUsage: server.today_usage,
  }
}

function normalizeIssuedServer(
  response: IssuedServerResponse
): IssuedServerKey {
  return { key: response.key, server: normalizeServer(response.server) }
}
