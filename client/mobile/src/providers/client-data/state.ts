import type { getClientDataBootstrapState } from "@/providers/client-data-bootstrap"

export function combineClientDataState(input: {
  enabled: boolean
  currentUserAvailable: boolean
  contactsAvailable: boolean
  conversationsAvailable: boolean
  contactsLocalReady: boolean
  conversationsLocalReady: boolean
  profilesReady: boolean
  bootstrapState: ReturnType<typeof getClientDataBootstrapState>
}) {
  const bootstrapReady = input.enabled && input.bootstrapState.ready
  const isReady = input.enabled && input.currentUserAvailable && input.contactsAvailable && input.conversationsAvailable && input.contactsLocalReady && input.conversationsLocalReady && input.profilesReady
  return { bootstrapReady, blockingBootstrapError: input.enabled ? input.bootstrapState.blockingError : null, isReady }
}
