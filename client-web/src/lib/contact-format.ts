export function formatContactPhone(phone: string) {
  if (phone.startsWith("+86")) {
    return phone.slice(3)
  }

  return phone
}
