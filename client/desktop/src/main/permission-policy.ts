export function isAllowedMainWindowPermission(
  permission: string,
  isMainWindow: boolean,
  isMainFrame: boolean,
): boolean {
  return permission === "notifications" && isMainWindow && isMainFrame
}
