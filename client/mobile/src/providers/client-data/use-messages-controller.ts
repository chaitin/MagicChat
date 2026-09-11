export function useMessagesController(operations: { messages: string }, enabled: boolean) {
  return {
    data: undefined,
    localReady: !enabled || operations.messages === "ready" || operations.messages === "failed",
    refreshState: false,
    error: null,
    refresh: async () => undefined,
  }
}
