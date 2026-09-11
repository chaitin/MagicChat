import type {
  ClientUser,
  ContactApp,
  ContactDirectoryMode,
  ContactUser,
  FriendRequest,
} from "@/lib/client-data-api"

export type ClientUserProfile = ClientUser | ContactUser

export type ClientUserRelationship = {
  incomingRequest: FriendRequest | null
  isFriend: boolean
  outgoingRequest: FriendRequest | null
}

export type ClientUserRelationshipSource = {
  contactDirectoryMode: ContactDirectoryMode
  contacts: ContactUser[]
  incomingFriendRequests: FriendRequest[]
  outgoingFriendRequests: FriendRequest[]
}

export type ClientProfileSnapshot = {
  contactApps: ContactApp[]
  contactDirectoryMode: ContactDirectoryMode
  contacts: ContactUser[]
  incomingFriendRequests: FriendRequest[]
  me: ClientUser
  outgoingFriendRequests: FriendRequest[]
  usersById: Readonly<Record<string, ContactUser>>
}

type Listener = () => void

export class ClientProfileStore {
  private appListeners = new Map<string, Set<Listener>>()
  private apps = new Map<string, ContactApp>()
  private currentUserId = ""
  private currentUserIdListeners = new Set<Listener>()
  private userListeners = new Map<string, Set<Listener>>()
  private userRelationshipListeners = new Map<string, Set<Listener>>()
  private userRelationships = new Map<string, ClientUserRelationship>()
  private unknownUserRelationship: ClientUserRelationship = {
    incomingRequest: null,
    isFriend: true,
    outgoingRequest: null,
  }
  private users = new Map<string, ClientUserProfile>()

  constructor(snapshot: ClientProfileSnapshot) {
    this.replace(snapshot, false)
  }

  getApp(appId: string | null | undefined) {
    return this.apps.get(normalizeProfileId(appId))
  }

  getCurrentUserId() {
    return this.currentUserId
  }

  getUser(userId: string | null | undefined) {
    return this.users.get(normalizeProfileId(userId))
  }

  getUserRelationship(userId: string | null | undefined) {
    return (
      this.userRelationships.get(normalizeProfileId(userId)) ??
      this.unknownUserRelationship
    )
  }

  replace(snapshot: ClientProfileSnapshot, notify = true) {
    const nextUsers = new Map<string, ClientUserProfile>()
    for (const profile of Object.values(snapshot.usersById)) {
      nextUsers.set(normalizeProfileId(profile.id), profile)
    }
    for (const contact of snapshot.contacts) {
      nextUsers.set(normalizeProfileId(contact.id), contact)
    }
    nextUsers.set(normalizeProfileId(snapshot.me.id), snapshot.me)

    const nextApps = new Map<string, ContactApp>()
    for (const app of snapshot.contactApps) {
      nextApps.set(normalizeProfileId(app.id), app)
    }

    const reconciledUsers = reconcileProfiles(
      this.users,
      nextUsers,
      areUserProfilesEqual
    )
    const reconciledApps = reconcileProfiles(
      this.apps,
      nextApps,
      areAppProfilesEqual
    )
    const nextCurrentUserId = normalizeProfileId(snapshot.me.id)
    this.unknownUserRelationship = {
      incomingRequest: null,
      isFriend: snapshot.contactDirectoryMode !== "friends",
      outgoingRequest: null,
    }
    const nextRelationships = new Map<string, ClientUserRelationship>()
    const relationshipSource: ClientUserRelationshipSource = {
      contactDirectoryMode: snapshot.contactDirectoryMode,
      contacts: snapshot.contacts,
      incomingFriendRequests: snapshot.incomingFriendRequests,
      outgoingFriendRequests: snapshot.outgoingFriendRequests,
    }
    for (const userId of nextUsers.keys()) {
      nextRelationships.set(
        userId,
        resolveClientUserRelationship(
          relationshipSource,
          userId,
          nextCurrentUserId
        )
      )
    }
    const reconciledRelationships = reconcileProfiles(
      this.userRelationships,
      nextRelationships,
      areUserRelationshipsEqual
    )
    const currentUserIdChanged = this.currentUserId !== nextCurrentUserId

    this.users = reconciledUsers.profiles
    this.apps = reconciledApps.profiles
    this.userRelationships = reconciledRelationships.profiles
    this.currentUserId = nextCurrentUserId

    if (!notify) {
      return
    }
    for (const userId of reconciledUsers.changedIds) {
      notifyListeners(this.userListeners.get(userId))
    }
    for (const appId of reconciledApps.changedIds) {
      notifyListeners(this.appListeners.get(appId))
    }
    for (const userId of reconciledRelationships.changedIds) {
      notifyListeners(this.userRelationshipListeners.get(userId))
    }
    if (currentUserIdChanged) {
      notifyListeners(this.currentUserIdListeners)
    }
  }

  subscribeApp(appId: string | null | undefined, listener: Listener) {
    return subscribeById(this.appListeners, normalizeProfileId(appId), listener)
  }

  subscribeCurrentUserId(listener: Listener) {
    this.currentUserIdListeners.add(listener)
    return () => this.currentUserIdListeners.delete(listener)
  }

  subscribeUser(userId: string | null | undefined, listener: Listener) {
    return subscribeById(
      this.userListeners,
      normalizeProfileId(userId),
      listener
    )
  }

  subscribeUserRelationship(
    userId: string | null | undefined,
    listener: Listener
  ) {
    return subscribeById(
      this.userRelationshipListeners,
      normalizeProfileId(userId),
      listener
    )
  }
}

export function resolveClientUserRelationship(
  source: ClientUserRelationshipSource,
  userId: string,
  currentUserId: string
): ClientUserRelationship {
  const normalizedUserId = normalizeProfileId(userId)
  const normalizedCurrentUserId = normalizeProfileId(currentUserId)
  const incomingFriendRequests = source.incomingFriendRequests ?? []
  const outgoingFriendRequests = source.outgoingFriendRequests ?? []
  const incomingRequest =
    incomingFriendRequests.find(
      (request) =>
        request.status === "pending" &&
        normalizeProfileId(request.requesterUserId) === normalizedUserId &&
        normalizeProfileId(request.addresseeUserId) === normalizedCurrentUserId
    ) ?? null
  const outgoingRequest =
    outgoingFriendRequests.find(
      (request) =>
        request.status === "pending" &&
        normalizeProfileId(request.addresseeUserId) === normalizedUserId &&
        normalizeProfileId(request.requesterUserId) === normalizedCurrentUserId
    ) ?? null
  const isFriend =
    normalizedUserId === normalizedCurrentUserId ||
    source.contactDirectoryMode !== "friends" ||
    (source.contacts ?? []).some(
      (contact) => normalizeProfileId(contact.id) === normalizedUserId
    )

  return { incomingRequest, isFriend, outgoingRequest }
}

function areFriendRequestsEqual(
  left: FriendRequest | null,
  right: FriendRequest | null
) {
  if (left === right) {
    return true
  }
  if (!left || !right) {
    return false
  }
  return (
    left.addresseeUserId === right.addresseeUserId &&
    left.createdAt === right.createdAt &&
    left.handledAt === right.handledAt &&
    left.id === right.id &&
    left.requesterUserId === right.requesterUserId &&
    left.status === right.status &&
    left.updatedAt === right.updatedAt
  )
}

function areUserRelationshipsEqual(
  left: ClientUserRelationship,
  right: ClientUserRelationship
) {
  return (
    areFriendRequestsEqual(left.incomingRequest, right.incomingRequest) &&
    left.isFriend === right.isFriend &&
    areFriendRequestsEqual(left.outgoingRequest, right.outgoingRequest)
  )
}

function reconcileProfiles<T>(
  current: ReadonlyMap<string, T>,
  incoming: ReadonlyMap<string, T>,
  equal: (left: T, right: T) => boolean
) {
  const profiles = new Map<string, T>()
  const changedIds = new Set(current.keys())

  for (const [id, profile] of incoming) {
    const previous = current.get(id)
    if (previous && equal(previous, profile)) {
      profiles.set(id, previous)
      changedIds.delete(id)
      continue
    }
    profiles.set(id, profile)
    changedIds.add(id)
  }

  return { changedIds, profiles }
}

function areUserProfilesEqual(
  left: ClientUserProfile,
  right: ClientUserProfile
) {
  if (
    left.avatar !== right.avatar ||
    left.email !== right.email ||
    left.id !== right.id ||
    left.lastOnlineAt !== right.lastOnlineAt ||
    left.name !== right.name ||
    left.nickname !== right.nickname ||
    left.phone !== right.phone
  ) {
    return false
  }

  if ("status" in left || "status" in right) {
    return (
      "status" in left &&
      "status" in right &&
      left.createdAt === right.createdAt &&
      left.status === right.status
    )
  }

  return left.online === right.online && left.type === right.type
}

function areAppProfilesEqual(left: ContactApp, right: ContactApp) {
  return (
    left.avatar === right.avatar &&
    left.creatorUserId === right.creatorUserId &&
    left.description === right.description &&
    left.id === right.id &&
    left.name === right.name &&
    left.online === right.online &&
    left.type === right.type
  )
}

function normalizeProfileId(profileId: string | null | undefined) {
  return profileId?.trim().toLowerCase() ?? ""
}

function notifyListeners(listeners: ReadonlySet<Listener> | undefined) {
  if (!listeners) {
    return
  }
  for (const listener of [...listeners]) {
    listener()
  }
}

function subscribeById(
  listenersById: Map<string, Set<Listener>>,
  id: string,
  listener: Listener
) {
  if (!id) {
    return () => undefined
  }

  const listeners = listenersById.get(id) ?? new Set<Listener>()
  listeners.add(listener)
  listenersById.set(id, listeners)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      listenersById.delete(id)
    }
  }
}
