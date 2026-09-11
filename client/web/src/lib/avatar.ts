export function getAvatarInitial(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?"
}
