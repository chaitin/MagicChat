import type {
  ClientDataErrorEnvelope,
  ClientDataSuccessEnvelope,
} from "./types"

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

export function normalizeVisibility(value: string | undefined) {
  return value === "public" ? "public" : "private"
}

export function createRequestError(
  payload:
    ClientDataErrorEnvelope | ClientDataSuccessEnvelope<unknown> | undefined,
  response: Response,
  fallbackMessage: string
) {
  const error = (payload as ClientDataErrorEnvelope | undefined)?.error

  return new ClientDataRequestError(error?.message ?? fallbackMessage, {
    code: error?.code,
    status: response.status,
  })
}

export async function readJson<T>(response: Response): Promise<T | undefined> {
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    return undefined
  }

  return response.json() as Promise<T>
}
