export function desktopBuild(): number {
  const value = process.env.MAGICCHAT_DESKTOP_BUILD
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error("Desktop build metadata invalid")
  }
  const build = Number(value)
  if (!Number.isSafeInteger(build) || build < 0) {
    throw new Error("Desktop build metadata invalid")
  }
  return build
}
