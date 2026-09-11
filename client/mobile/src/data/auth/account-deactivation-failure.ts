import { ApiRequestError } from "@/data/api-client"

/** Only explicit pre-commit validation rejection proves the remote account remains active. */
export function isSafeAccountDeactivationRejection(error: unknown) {
  return error instanceof ApiRequestError && (
    (error.status === 401 && error.code === "invalid_code") ||
    (error.status === 400 && error.code === "invalid_request")
  )
}
