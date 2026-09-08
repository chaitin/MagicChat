export function countReportDescriptionCharacters(value: string) {
  return Array.from(value).length
}

export function limitReportDescription(value: string, maxLength: number) {
  const characters = Array.from(value)
  return characters.length <= maxLength
    ? value
    : characters.slice(0, maxLength).join("")
}
