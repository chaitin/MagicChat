import {
  ACCOUNT_DATA_CHANNELS,
  type ContactTargetInput,
  type FriendRequestListInput,
  type OpenContactConversationInput,
  type SaveClientAppInput,
  type UpdateClientAppInput,
  type UploadClientAppAvatarInput,
} from "../../shared/account-data"
import type { IpcRegistrar } from "./register-account-data-ipc"

export interface ContactIpcOperations {
  refreshContacts(targetId: string): Promise<unknown>
  searchContactUsers(input: { targetId: string; query: string }): Promise<unknown>
  listFriendRequests(input: FriendRequestListInput): Promise<unknown>
  createFriendRequest(input: ContactTargetInput): Promise<unknown>
  acceptFriendRequest(input: ContactTargetInput): Promise<unknown>
  rejectFriendRequest(input: ContactTargetInput): Promise<unknown>
  cancelFriendRequest(input: ContactTargetInput): Promise<unknown>
  deleteFriend(input: ContactTargetInput): Promise<unknown>
  openContactConversation(input: OpenContactConversationInput): Promise<unknown>
  createClientApp(input: SaveClientAppInput): Promise<unknown>
  getClientApp(input: ContactTargetInput): Promise<unknown>
  updateClientApp(input: UpdateClientAppInput): Promise<unknown>
  deleteClientApp(input: ContactTargetInput): Promise<unknown>
  regenerateClientAppSecret(input: ContactTargetInput): Promise<unknown>
  selectClientAppAvatar(targetId: string): Promise<unknown>
  uploadClientAppAvatar(input: UploadClientAppAvatarInput): Promise<unknown>
}

export function registerContactIpc({
  handle,
  operations,
}: {
  handle: IpcRegistrar
  operations: ContactIpcOperations
}) {
  handle(ACCOUNT_DATA_CHANNELS.refreshContacts, (input) =>
    operations.refreshContacts(typeof input === "string" ? input : ""),
  )
  handle(ACCOUNT_DATA_CHANNELS.searchContactUsers, (input) =>
    operations.searchContactUsers(input as { targetId: string; query: string }),
  )
  handle(ACCOUNT_DATA_CHANNELS.listFriendRequests, (input) =>
    operations.listFriendRequests(input as FriendRequestListInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.createFriendRequest, (input) =>
    operations.createFriendRequest(input as ContactTargetInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.acceptFriendRequest, (input) =>
    operations.acceptFriendRequest(input as ContactTargetInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.rejectFriendRequest, (input) =>
    operations.rejectFriendRequest(input as ContactTargetInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.cancelFriendRequest, (input) =>
    operations.cancelFriendRequest(input as ContactTargetInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.deleteFriend, (input) =>
    operations.deleteFriend(input as ContactTargetInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.openContactConversation, (input) =>
    operations.openContactConversation(input as OpenContactConversationInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.createClientApp, (input) =>
    operations.createClientApp(input as SaveClientAppInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.getClientApp, (input) =>
    operations.getClientApp(input as ContactTargetInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.updateClientApp, (input) =>
    operations.updateClientApp(input as UpdateClientAppInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.deleteClientApp, (input) =>
    operations.deleteClientApp(input as ContactTargetInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.regenerateClientAppSecret, (input) =>
    operations.regenerateClientAppSecret(input as ContactTargetInput),
  )
  handle(ACCOUNT_DATA_CHANNELS.selectClientAppAvatar, (input) =>
    operations.selectClientAppAvatar(typeof input === "string" ? input : ""),
  )
  handle(ACCOUNT_DATA_CHANNELS.uploadClientAppAvatar, (input) =>
    operations.uploadClientAppAvatar(input as UploadClientAppAvatarInput),
  )
}
