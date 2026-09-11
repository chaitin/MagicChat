export type LoginBootstrapOperations = {
  fetchContacts: () => Promise<unknown>
  fetchCurrentUser: () => Promise<unknown>
  fetchProjects: () => Promise<unknown>
  waitForRealtime: () => Promise<void>
  bootstrapMessages: () => Promise<void>
}

export function runLoginBootstrapOperations(
  operations: LoginBootstrapOperations
) {
  return Promise.all([
    operations.bootstrapMessages(),
    operations.waitForRealtime(),
    operations.fetchCurrentUser(),
    operations.fetchContacts(),
    operations.fetchProjects(),
  ]).then(() => undefined)
}
