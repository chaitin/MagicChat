type SortableContact = {
  email: string
  id: string
  name: string
  nickname: string
}

const contactNameCollator = new Intl.Collator("zh-CN-u-co-pinyin", {
  numeric: true,
  sensitivity: "base",
  usage: "sort",
})

export function sortContactsByDisplayName<T extends SortableContact>(
  contacts: readonly T[]
) {
  return [...contacts].sort(compareContactsByDisplayName)
}

function compareContactsByDisplayName<T extends SortableContact>(
  left: T,
  right: T
) {
  return (
    compareContactText(getContactSortName(left), getContactSortName(right)) ||
    compareContactText(left.email, right.email) ||
    compareContactText(left.id, right.id)
  )
}

function getContactSortName(contact: SortableContact) {
  return contact.nickname.trim() || contact.name.trim()
}

function compareContactText(left: string, right: string) {
  return contactNameCollator.compare(left.trim(), right.trim())
}
