import assert from "node:assert/strict"
import test from "node:test"

import type { ClientContacts, ContactUser } from "@/core/models"
import { getContactDisplayName } from "@/domain/contacts/contact-display"
import {
  buildDirectoryCategorySections,
  buildDirectorySections,
  DIRECTORY_CATEGORY_TITLES,
  isDirectoryCategory,
} from "@/features/contacts/contact-directory-model"

function createContact(
  id: string,
  name: string,
  nickname = ""
): ContactUser {
  return {
    avatar: "",
    email: `${id}@example.com`,
    id,
    lastOnlineAt: null,
    name,
    nickname,
    online: false,
    phone: "",
    type: "user",
  }
}

test("联系人按英文或中文拼音从 A 到 Z 排列，并将特殊首字符放到最后", () => {
  const contacts: ClientContacts = {
    apps: [],
    groups: [],
    users: [
      createContact("zhang", "张三"),
      createContact("special", "#客服"),
      createContact("bob", "Bob"),
      createContact("number", "2号联系人"),
      createContact("li", "李雷"),
      createContact("nickname", "赵六", "Alice"),
      createContact("a", "阿文"),
    ],
  }
  const sections = buildDirectorySections({
    activeTab: "user",
    contacts,
    currentUserId: "current-user",
    keyword: "",
  })
  const names = sections.flatMap((section) =>
    section.data.map((item) =>
      item.type === "user" ? getContactDisplayName(item.value) : ""
    )
  )

  assert.deepEqual(
    sections.map((section) => section.title),
    ["A", "B", "L", "Z", "#"]
  )
  assert.deepEqual(names.slice(0, 5), ["Alice", "阿文", "Bob", "李雷", "张三"])
  assert.deepEqual(new Set(names.slice(5)), new Set(["#客服", "2号联系人"]))
})

test("新朋友分类使用独立标题并暂时返回空列表", () => {
  const contacts: ClientContacts = {
    apps: [],
    groups: [],
    users: [createContact("friend", "新朋友")],
  }

  assert.equal(isDirectoryCategory("new-friends"), true)
  assert.equal(DIRECTORY_CATEGORY_TITLES["new-friends"], "新朋友")
  assert.deepEqual(
    buildDirectoryCategorySections({
      category: "new-friends",
      contacts,
      currentUserId: "current-user",
    }),
    []
  )
})
