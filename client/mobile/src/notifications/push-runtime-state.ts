import type { PushAccountIdentity } from "@/notifications/push-types"

let current: PushAccountIdentity | null = null
let remote: PushAccountIdentity | null = null

export function setCurrentPushIdentity(identity: PushAccountIdentity | null) {
  current = clone(identity)
  if (!identity || !matches(remote, identity)) remote = null
}

export function setActiveRemotePushTarget(identity: PushAccountIdentity | null) {
  remote = identity && matches(current, identity) ? clone(identity) : null
}

export function hasActiveRemotePushDelegation(identity: PushAccountIdentity) {
  return matches(remote, identity)
}

export function isCurrentPushIdentity(identity: PushAccountIdentity) {
  return matches(current, identity)
}

function clone(identity: PushAccountIdentity | null) {
  return identity ? { ...identity, target: { ...identity.target } } : null
}
function matches(first: PushAccountIdentity | null, second: PushAccountIdentity) {
  return first?.accountId === second.accountId && first.generation === second.generation &&
    first.target.id === second.target.id && first.target.url.replace(/\/+$/, "") === second.target.url.replace(/\/+$/, "") &&
    first.target.userId === second.target.userId
}
