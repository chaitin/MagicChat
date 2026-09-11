import type { ClientProjectPage } from "@/core/models"
import type { AuthenticatedTarget } from "@/core/server-target"
import { databaseService } from "@/data/database/database-service"
import { createServerKey } from "@/data/server-key"

export const ROOT_CURSOR = "__root__"

export async function readProjectPages(target: AuthenticatedTarget) {
  const result = new Map<string, ClientProjectPage>()
  const rows = await databaseService.read("projects.pages.read", (db) => db.getAll<{ request_cursor: string; payload_json: string }>(
    "SELECT request_cursor,payload_json FROM cached_project_pages WHERE server_key = ? AND user_id = ?",
    [createServerKey(target), target.userId]
  ))
  for (const row of rows) try { result.set(row.request_cursor, JSON.parse(row.payload_json) as ClientProjectPage) } catch { /* isolate corrupt rows */ }
  return result
}

export async function writeProjectPage(target: AuthenticatedTarget, cursor: string, page: ClientProjectPage) {
  await databaseService.write("projects.page.write", (db) => db.run(
    `INSERT OR REPLACE INTO cached_project_pages
     (server_key,user_id,request_cursor,payload_json,next_cursor,cached_at) VALUES (?,?,?,?,?,?)`,
    [createServerKey(target), target.userId, cursor, JSON.stringify(page), page.nextCursor, Date.now()]
  ))
}
