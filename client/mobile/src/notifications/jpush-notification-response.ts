export type JPushNotificationResponse = {
  data: {
    event: "message.created"
    grant_id: string
    route_token: string
  }
  date: number
  identifier: string
}

export type NativeJPushNotificationResponse = {
  date?: unknown
  event?: unknown
  grantId?: unknown
  identifier?: unknown
  routeToken?: unknown
}

export function normalizeJPushNotificationResponse(
  value: NativeJPushNotificationResponse | null
): JPushNotificationResponse | null {
  if (
    !value ||
    value.event !== "message.created" ||
    typeof value.grantId !== "string" ||
    !value.grantId.trim() ||
    typeof value.routeToken !== "string" ||
    value.routeToken.trim().length < 32 ||
    typeof value.date !== "number" ||
    !Number.isFinite(value.date)
  ) {
    return null
  }
  return {
    data: {
      event: "message.created",
      grant_id: value.grantId.trim(),
      route_token: value.routeToken.trim(),
    },
    date: value.date,
    identifier:
      typeof value.identifier === "string" ? value.identifier.trim() : "",
  }
}
