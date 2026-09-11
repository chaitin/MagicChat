export function getContactDisplayName(contact: {
  name: string
  nickname: string
}) {
  return contact.nickname.trim() || contact.name.trim()
}

export function formatContactPhone(phone: string) {
  return phone.startsWith("+86") ? phone.slice(3) : phone
}
