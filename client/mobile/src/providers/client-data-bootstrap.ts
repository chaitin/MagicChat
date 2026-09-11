import { isConnectionError, isUnauthorizedError } from "@/data/api-client"

type BootstrapResource = {
  available: boolean
  error: Error | null
}

export function getClientDataBootstrapState(resources: BootstrapResource[]) {
  const ready = resources.every((resource) => resource.available)
  const blockingError = ready
    ? null
    : (resources.find(
        (resource) =>
          !resource.available &&
          !isUnauthorizedError(resource.error) &&
          isConnectionError(resource.error)
      )?.error ?? null)

  return { blockingError, ready }
}
