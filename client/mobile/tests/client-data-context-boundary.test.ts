import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("client data exposes compatible aggregate and fine-grained hooks", async () => {
  const entry = await readFile("src/providers/client-data-provider.tsx", "utf8")
  for (const name of ["useClientData", "useClientSession", "useClientContacts", "useClientConversations", "useClientProjects", "useClientDataStatus"]) {
    assert.match(entry, new RegExp(`\\b${name}\\b`), `${name} must be public`)
  }
})

test("provider memoizes and independently provides every client-data domain", async () => {
  const source = await readFile("src/providers/client-data/provider.tsx", "utf8")
  for (const domain of ["session", "contacts", "conversations", "projects", "status"]) {
    assert.match(source, new RegExp(`const ${domain}Value = useMemo\\(`), `${domain} value must be memoized`)
  }
  for (const context of ["ClientSessionContext", "ClientContactsContext", "ClientConversationsContext", "ClientProjectsContext", "ClientDataStatusContext"]) {
    assert.match(source, new RegExp(`<${context}\\.Provider value=`), `${context} must have its own provider`)
  }
  assert.doesNotMatch(source, /ClientDataContext\.Provider/, "aggregate compatibility must not restore a single invalidation boundary")
})
