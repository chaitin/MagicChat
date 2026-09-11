import * as React from "react"

import {
  type ClientProfileData,
  ClientProfileContext,
} from "@/lib/client-profile-context"
import { ClientProfileStore } from "@/lib/client-profile-store"

export function ClientProfileProvider({
  acceptFriendRequest,
  children,
  contactApps,
  contactDirectoryMode,
  contacts,
  createFriendRequest,
  incomingFriendRequests,
  me,
  openAppConversation,
  openDirectConversation,
  outgoingFriendRequests,
  usersById,
}: ClientProfileData & { children: React.ReactNode }) {
  const [store] = React.useState(
    () =>
      new ClientProfileStore({
        contactApps,
        contactDirectoryMode,
        contacts,
        incomingFriendRequests,
        me,
        outgoingFriendRequests,
        usersById,
      })
  )
  React.useLayoutEffect(() => {
    store.replace({
      contactApps,
      contactDirectoryMode,
      contacts,
      incomingFriendRequests,
      me,
      outgoingFriendRequests,
      usersById,
    })
  }, [
    contactApps,
    contactDirectoryMode,
    contacts,
    incomingFriendRequests,
    me,
    outgoingFriendRequests,
    store,
    usersById,
  ])

  const value = React.useMemo(
    () => ({
      acceptFriendRequest,
      createFriendRequest,
      openAppConversation,
      openDirectConversation,
      store,
    }),
    [
      acceptFriendRequest,
      createFriendRequest,
      openAppConversation,
      openDirectConversation,
      store,
    ]
  )

  return (
    <ClientProfileContext.Provider value={value}>
      {children}
    </ClientProfileContext.Provider>
  )
}
