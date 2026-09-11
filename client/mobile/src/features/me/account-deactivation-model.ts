export function normalizeDeactivationCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 8)
}
