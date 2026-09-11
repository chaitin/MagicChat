import { describe, expect, it } from "vitest"

import type {
  ClientTopicSourceMessage,
  ClientUser,
  ContactApp,
  ContactUser,
} from "@/lib/client-data-api"
import { getTopicSourceSenderProfile } from "@/lib/topic-source-message"

const member: ContactUser = {
  avatar: "https://example.test/member.png",
  email: "member@example.test",
  id: "member-id",
  lastOnlineAt: null,
  name: "成员姓名",
  nickname: "成员昵称",
  online: false,
  phone: "",
  type: "user",
}

const app: ContactApp = {
  avatar: "https://example.test/app.png",
  creatorUserId: null,
  description: "应用",
  id: "app-id",
  name: "应用名称",
  online: true,
  type: "app",
}

const me: ClientUser = {
  avatar: "https://example.test/me.png",
  createdAt: "2026-01-01T00:00:00",
  email: "me@example.test",
  id: "me-id",
  lastOnlineAt: null,
  name: "我的姓名",
  nickname: "我的昵称",
  phone: "",
  status: "active",
}

describe("getTopicSourceSenderProfile", () => {
  it("resolves a user sender from the contact directory", () => {
    const sender: ClientTopicSourceMessage["sender"] = {
      avatar: "",
      id: member.id,
      name: "",
      type: "user",
    }

    expect(
      getTopicSourceSenderProfile(sender, me, { [member.id]: member }, new Map())
    ).toEqual({ avatar: member.avatar, name: member.nickname })
  })

  it("falls back to the api sender values when the user is unknown", () => {
    const sender: ClientTopicSourceMessage["sender"] = {
      avatar: "https://example.test/api.png",
      id: "unknown-user",
      name: "API 姓名",
      type: "user",
    }

    expect(
      getTopicSourceSenderProfile(sender, me, {}, new Map())
    ).toEqual({ avatar: sender.avatar, name: sender.name })
  })

  it("uses the current user profile for self messages", () => {
    const sender: ClientTopicSourceMessage["sender"] = {
      avatar: "",
      id: me.id,
      name: "",
      type: "user",
    }

    expect(
      getTopicSourceSenderProfile(sender, me, {}, new Map())
    ).toEqual({ avatar: me.avatar, name: me.nickname })
  })

  it("resolves an app sender from the apps directory", () => {
    const sender: ClientTopicSourceMessage["sender"] = {
      avatar: "",
      id: app.id,
      name: "",
      type: "app",
    }

    expect(
      getTopicSourceSenderProfile(
        sender,
        me,
        {},
        new Map([[app.id, app]])
      )
    ).toEqual({ avatar: app.avatar, name: app.name })
  })
})
