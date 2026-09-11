import type { Href } from "expo-router"

import type { EntityReference } from "@/domain/entities/entity-profile"

export function buildEntityDetailHref(reference: EntityReference): Href {
  return {
    params: {
      entityId: reference.id,
      entityType: reference.type,
    },
    pathname: "/(app)/entity/[entityType]/[entityId]",
  } as unknown as Href
}
