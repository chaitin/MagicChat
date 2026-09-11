export type ServerTarget = {
  id: string
  url: string
}

export type AuthenticatedTarget = ServerTarget & {
  userId: string
}
