import type { RealtimeClient } from "@/realtime/realtime-client"

export type RealtimeIdentity = Readonly<{ accountId: string; generation: number }>

/** Owns the process' single active business realtime connection. */
export class RealtimeClientSlot {
  private record: { client: RealtimeClient; identity: RealtimeIdentity } | null = null

  replace(client: RealtimeClient, identity: RealtimeIdentity) {
    const previous = this.record
    this.record = null
    previous?.client.disconnect()
    this.record = { client, identity: { ...identity } }
  }

  clear(client?: RealtimeClient) {
    if (client && this.record?.client !== client) return
    const previous = this.record
    this.record = null
    previous?.client.disconnect()
  }

  isCurrent(identity: RealtimeIdentity, client?: RealtimeClient) {
    return this.record?.identity.accountId === identity.accountId &&
      this.record.identity.generation === identity.generation &&
      (!client || this.record.client === client)
  }

  current() { return this.record }
}
