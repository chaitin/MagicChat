import type { OrganizationDirectoryNode } from "../../../../shared/organization-directory"

export function findOrganizationPath(
  nodes: OrganizationDirectoryNode[],
  key: string | null,
): OrganizationDirectoryNode[] {
  if (!key) return []
  for (const node of nodes) {
    if (node.key === key) return [node]
    const childPath = findOrganizationPath(node.children, key)
    if (childPath.length) return [node, ...childPath]
  }
  return []
}

export function searchOrganizationNodes(
  nodes: OrganizationDirectoryNode[],
  keyword: string,
): { node: OrganizationDirectoryNode; path: OrganizationDirectoryNode[] }[] {
  const query = keyword.trim().toLocaleLowerCase()
  if (!query) return []
  const results: { node: OrganizationDirectoryNode; path: OrganizationDirectoryNode[] }[] = []
  function visit(items: OrganizationDirectoryNode[], ancestors: OrganizationDirectoryNode[]) {
    for (const node of items) {
      const path = [...ancestors, node]
      if (node.name.toLocaleLowerCase().includes(query)) results.push({ node, path })
      visit(node.children, path)
    }
  }
  visit(nodes, [])
  return results
}
