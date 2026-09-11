import type { ClientProjectPage, ClientProjectSummary } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { fetchProjects } from "@/data/projects/projects-api"
import { readProjectPages, ROOT_CURSOR, writeProjectPage } from "@/data/projects/project-cache-store"
import { createServerKey } from "@/data/server-key"

const PAGE_SIZE = 100
export type ProjectSnapshot = { hasMore: boolean; pages: ClientProjectPage[]; personalProject: ClientProjectSummary | null; projects: ClientProjectSummary[] }
class ProjectManager {
  private pageMaps = new Map<string, Map<string, ClientProjectPage>>()
  private snapshots = new Map<string, ProjectSnapshot>()
  private loads = new Map<string, Promise<ProjectSnapshot>>()
  private flights = new Map<string, Promise<ProjectSnapshot>>()
  private listeners = new Map<string, Set<(snapshot: ProjectSnapshot) => void>>()
  async getSnapshot(target: AuthenticatedTarget) {
    const key = targetKey(target); const value = this.snapshots.get(key); if (value) return value
    let task = this.loads.get(key)
    if (!task) {
      task = readProjectPages(target)
        .then((pages) => { this.pageMaps.set(key, pages); return this.commit(target, assemble(pages), false) })
        .catch((error) => { this.loads.delete(key); throw error })
      this.loads.set(key, task)
    }
    return task
  }
  async refresh(target: AuthenticatedTarget) { return this.fetchPage(target, ROOT_CURSOR) }
  async loadMore(target: AuthenticatedTarget) {
    const snapshot = await this.getSnapshot(target); const cursor = snapshot.pages.at(-1)?.nextCursor
    return cursor ? this.fetchPage(target, cursor) : snapshot
  }
  subscribe(target: AuthenticatedTarget, listener: (snapshot: ProjectSnapshot) => void) {
    const key = targetKey(target); const set = this.listeners.get(key) ?? new Set(); set.add(listener); this.listeners.set(key, set)
    return () => { set.delete(listener); if (!set.size) this.listeners.delete(key) }
  }
  private async fetchPage(target: AuthenticatedTarget, cursor: string) {
    await this.getSnapshot(target); const flightKey = `${targetKey(target)}\0${cursor}`; let task = this.flights.get(flightKey)
    if (!task) {
      task = (async () => {
        const page = await fetchProjects(target, { cursor: cursor === ROOT_CURSOR ? undefined : cursor, limit: PAGE_SIZE })
        await writeProjectPage(target, cursor, page)
        const pages = this.pageMaps.get(targetKey(target)) ?? new Map(); pages.set(cursor, page); this.pageMaps.set(targetKey(target), pages)
        return this.commit(target, assemble(pages))
      })().finally(() => this.flights.delete(flightKey)); this.flights.set(flightKey, task)
    }
    return task
  }
  private commit(target: AuthenticatedTarget, value: ProjectSnapshot, notify = true) {
    const key = targetKey(target); const previous = this.snapshots.get(key); if (previous && JSON.stringify(previous) === JSON.stringify(value)) return previous
    this.snapshots.set(key, value); if (notify) for (const listener of this.listeners.get(key) ?? []) listener(value); return value
  }
}
function assemble(map: ReadonlyMap<string, ClientProjectPage>): ProjectSnapshot {
  const pages: ClientProjectPage[] = []; const seen = new Set<string>(); let cursor = ROOT_CURSOR
  while (!seen.has(cursor)) { seen.add(cursor); const page = map.get(cursor); if (!page) break; pages.push(page); if (!page.nextCursor) break; cursor = page.nextCursor }
  const projects = pages.flatMap((page) => page.projects); const last = pages.at(-1)
  return { hasMore: Boolean(last?.nextCursor), pages, personalProject: pages[0]?.personalProject ?? null, projects }
}
function targetKey(target: AuthenticatedTarget) { return `${createServerKey(target)}\0${target.userId}` }
export const projectManager = new ProjectManager()
