import { describe, expect, it, vi } from "vitest"

import {
  addGroupConversationMembers,
  ClientDataRequestError,
  createFriendRequest,
  createGroupConversation,
  dismissConversation,
  formatClientMessageBodySummary,
  getCurrentClientUser,
  listClientContacts,
  listClientConversations,
  listFriendRequests,
  listConversationMessages,
  normalizeMessageCreatedEventPayload,
  normalizeConversationPinUpdatedEventPayload,
  normalizeConversationMuteUpdatedEventPayload,
  normalizeClientMessageBody,
  resolveClientUsers,
  searchContactUsers,
  restoreConversation,
  sendConversationFileMessage,
  sendConversationImageMessage,
  sendConversationVideoMessage,
  sendConversationLinkMessage,
  sendConversationMarkdownMessage,
  sendConversationCardMessage,
  sendConversationEntityCardMessage,
  sendConversationTextMessage,
  setConversationPinned,
  setConversationMuted,
  updateGroupConversationAnnouncement,
} from "@/lib/client-data-api"

describe("client data API", () => {
  it("loads the current client user with credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            user: {
              avatar: "/assets/avatars/builtin/17.webp",
              created_at: "2026-07-01T12:34:56Z",
              email: "alice@example.com",
              id: "user-1",
              name: "Alice Zhang",
              nickname: "Al",
              phone: "+8613912345678",
              status: "active",
            },
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    await expect(getCurrentClientUser(fetcher)).resolves.toEqual({
      avatar: "/assets/avatars/builtin/17.webp",
      createdAt: "2026-07-01T12:34:56Z",
      email: "alice@example.com",
      id: "user-1",
      lastOnlineAt: null,
      name: "Alice Zhang",
      nickname: "Al",
      phone: "+8613912345678",
      status: "active",
    })
    expect(fetcher).toHaveBeenCalledWith("/api/client/me", {
      credentials: "include",
      method: "GET",
    })
  })

  it("resolves users by ID", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            users: [
              {
                avatar: "/assets/avatars/builtin/03.webp",
                email: "bob@example.com",
                id: "user-2",
                last_online_at: "2026-07-03T01:00:00Z",
                name: "Bob Li",
                nickname: "",
                online: true,
                phone: "+8613912345679",
                type: "user",
                updated_at: "2026-07-03T02:00:00Z",
              },
            ],
          },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      )
    )

    await expect(resolveClientUsers(["user-2"], fetcher)).resolves.toEqual([
      {
        avatar: "/assets/avatars/builtin/03.webp",
        email: "bob@example.com",
        id: "user-2",
        lastOnlineAt: "2026-07-03T01:00:00Z",
        name: "Bob Li",
        nickname: "",
        online: true,
        phone: "+8613912345679",
        type: "user",
        updatedAt: "2026-07-03T02:00:00Z",
      },
    ])
    expect(fetcher).toHaveBeenCalledWith("/api/client/users/resolve", {
      body: JSON.stringify({ user_ids: ["user-2"] }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  })

  it("loads unified client contacts with credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            apps: [
              {
                avatar: "/assets/apps/assistant.webp",
                creator_user_id: null,
                description: "专属 AI 助理",
                id: "app-1",
                name: "茉莉",
                online: false,
                type: "app",
              },
            ],
            directory_mode: "organization",
            groups: [
              {
                avatar: "",
                id: "group-1",
                joined: true,
                member_count: 1,
                avatar_members: [
                  {
                    id: "user-2",
                    role: "member",
                    type: "user",
                  },
                ],
                name: "已加入群",
                type: "group",
                visibility: "private",
              },
            ],
            user_ids: ["user-2"],
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    await expect(listClientContacts(fetcher)).resolves.toEqual({
      apps: [
        {
          avatar: "/assets/apps/assistant.webp",
          creatorUserId: null,
          description: "专属 AI 助理",
          id: "app-1",
          name: "茉莉",
          online: false,
          type: "app",
        },
      ],
      directoryMode: "organization",
      groups: [
        {
          avatar: "",
          avatarMembers: [
            {
              avatar: "",
              id: "user-2",
              name: "",
              nickname: "",
              role: "member",
              type: "user",
            },
          ],
          id: "group-1",
          joined: true,
          memberCount: 1,
          name: "已加入群",
          type: "group",
          visibility: "private",
        },
      ],
      userIds: ["user-2"],
    })
    expect(fetcher).toHaveBeenCalledWith("/api/client/contacts", {
      credentials: "include",
      method: "GET",
    })
  })

  it("searches users and maps friend request APIs", async () => {
    const searchFetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, data: { user_ids: ["user-2"] } }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
      )
    await expect(
      searchContactUsers("bob@example.com", searchFetcher)
    ).resolves.toEqual(["user-2"])

    const requestPayload = {
      addressee_user_id: "user-2",
      created_at: "2026-08-11T00:00:00Z",
      handled_at: null,
      id: "request-1",
      requester_user_id: "user-1",
      status: "pending",
      updated_at: "2026-08-11T00:00:00Z",
    }
    const createFetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: requestPayload }), {
        headers: { "content-type": "application/json" },
        status: 201,
      })
    )
    await expect(
      createFriendRequest("user-2", createFetcher)
    ).resolves.toMatchObject({
      id: "request-1",
      status: "pending",
    })
    expect(createFetcher).toHaveBeenCalledWith("/api/client/friend-requests", {
      body: JSON.stringify({ user_id: "user-2" }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })

    const listFetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: { requests: [requestPayload] },
          }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
      )
    await expect(
      listFriendRequests("incoming", listFetcher)
    ).resolves.toHaveLength(1)
  })

  it("loads client conversations with credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            conversations: [
              {
                avatar: "/assets/avatars/builtin/03.webp",
                created_at: "2026-07-03T07:00:00Z",
                id: "conversation-1",
                last_message_at: "2026-07-03T08:00:00Z",
                last_message_id: "message-1",
                last_message_seq: 12,
                last_message_sender: {
                  id: "user-2",
                  name: "Bob Li",
                  nickname: "Bob",
                  type: "user",
                },
                last_message_summary: "好的，我看一下",
                member_count: 2,
                name: "Bob Li",
                notification_muted: false,
                pinned: false,
                type: "direct",
              },
            ],
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    await expect(listClientConversations(fetcher)).resolves.toEqual([
      {
        announcement: "",
        avatar: "/assets/avatars/builtin/03.webp",
        canSend: true,
        createdAt: "2026-07-03T07:00:00Z",
        id: "conversation-1",
        lastMessageAt: "2026-07-03T08:00:00Z",
        lastMessageId: "message-1",
        lastMessageSeq: 12,
        lastMessageSender: {
          id: "user-2",
          name: "Bob Li",
          nickname: "Bob",
          type: "user",
        },
        lastMessageSummary: "好的，我看一下",
        lastChoiceSeq: 0,
        lastMentionedSeq: 0,
        lastReadSeq: 0,
        memberCount: 2,
        name: "Bob Li",
        notificationMuted: false,
        pinned: false,
        type: "direct",
        unreadCount: 0,
        visibility: "private",
      },
    ])
    expect(fetcher).toHaveBeenCalledWith("/api/client/conversations", {
      credentials: "include",
      method: "GET",
    })
  })

  it("updates and normalizes a group announcement", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            conversation: {
              announcement: "本周五发布 🚀",
              created_at: "2026-07-30T09:30:00Z",
              id: "conversation-group-1",
              name: "新品讨论组",
              type: "group",
            },
            message: null,
          },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      )
    )

    await expect(
      updateGroupConversationAnnouncement(
        "conversation-group-1",
        { announcement: "  本周五发布 🚀  " },
        fetcher
      )
    ).resolves.toMatchObject({
      conversation: {
        announcement: "本周五发布 🚀",
        id: "conversation-group-1",
      },
      message: null,
    })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/conversations/groups/conversation-group-1/announcement",
      {
        body: JSON.stringify({ announcement: "  本周五发布 🚀  " }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }
    )
  })

  it("sets conversation pin state with credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { conversation_id: "conversation-1", pinned: true },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      )
    )

    await expect(
      setConversationPinned("conversation-1", true, fetcher)
    ).resolves.toEqual({ conversationId: "conversation-1", pinned: true })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/conversations/conversation-1/pin",
      { credentials: "include", method: "PUT" }
    )

    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { conversation_id: "conversation-1", pinned: false },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      )
    )
    await expect(
      setConversationPinned("conversation-1", false, fetcher)
    ).resolves.toEqual({ conversationId: "conversation-1", pinned: false })
    expect(fetcher).toHaveBeenLastCalledWith(
      "/api/client/conversations/conversation-1/pin",
      { credentials: "include", method: "DELETE" }
    )
  })

  it("normalizes conversation pin realtime events", () => {
    expect(
      normalizeConversationPinUpdatedEventPayload({
        conversation_id: "conversation-1",
        pinned: false,
      })
    ).toEqual({ conversationId: "conversation-1", pinned: false })
  })

  it("sets conversation mute state and dismisses conversations", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { conversation_id: "conversation-1", muted: true },
          }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { conversation_id: "conversation-1" },
          }),
          { headers: { "content-type": "application/json" }, status: 200 }
        )
      )

    await expect(
      setConversationMuted("conversation-1", true, fetcher)
    ).resolves.toEqual({ conversationId: "conversation-1", muted: true })
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/client/conversations/conversation-1/mute",
      { credentials: "include", method: "PUT" }
    )

    await expect(
      dismissConversation("conversation-1", fetcher)
    ).resolves.toEqual({ conversationId: "conversation-1" })
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/client/conversations/conversation-1",
      { credentials: "include", method: "DELETE" }
    )
  })

  it("restores a hidden conversation", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            conversation: {
              created_at: "2026-07-03T09:30:00Z",
              id: "conversation-1",
              name: "新品讨论组",
              notification_muted: true,
              pinned: false,
              type: "group",
            },
          },
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      )
    )

    await expect(
      restoreConversation("conversation-1", fetcher)
    ).resolves.toMatchObject({
      id: "conversation-1",
      name: "新品讨论组",
      notificationMuted: true,
      pinned: false,
      type: "group",
    })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/conversations/conversation-1/restore",
      { credentials: "include", method: "POST" }
    )
  })

  it("normalizes conversation mute realtime events", () => {
    expect(
      normalizeConversationMuteUpdatedEventPayload({
        conversation_id: "conversation-1",
        muted: false,
      })
    ).toEqual({ conversationId: "conversation-1", muted: false })
  })

  it("creates a group conversation with credentials", async () => {
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              conversation: {
                created_at: "2026-07-03T09:30:00Z",
                created_by_user_id: "user-1",
                id: "conversation-group-1",
                last_message_at: "2026-07-03T09:30:00Z",
                last_message_id: "message-system-1",
                last_message_seq: 1,
                last_message_sender: {
                  id: "",
                  name: "系统",
                  nickname: "",
                  type: "system",
                },
                last_message_summary: "Alice 邀请 Bob Li 加入群聊",
                member_count: 2,
                members: [
                  {
                    avatar: "/assets/avatars/builtin/17.webp",
                    email: "alice@example.com",
                    id: "user-1",
                    name: "Alice",
                    nickname: "Al",
                    phone: "+8613912345678",
                    role: "owner",
                  },
                  {
                    avatar: "/assets/avatars/builtin/03.webp",
                    email: "bob@example.com",
                    id: "user-2",
                    name: "Bob Li",
                    nickname: "",
                    phone: "+8613912345679",
                    role: "member",
                  },
                ],
                name: "新品讨论组",
                posting_policy: "open",
                status: "active",
                type: "group",
              },
            },
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 201,
          }
        )
    )

    await expect(
      createGroupConversation(
        {
          appIds: ["app-1"],
          memberIds: ["user-2"],
          name: "新品讨论组",
        },
        fetcher
      )
    ).resolves.toEqual({
      announcement: "",
      avatar: "",
      canSend: true,
      createdAt: "2026-07-03T09:30:00Z",
      id: "conversation-group-1",
      lastMessageAt: "2026-07-03T09:30:00Z",
      lastMessageId: "message-system-1",
      lastMessageSeq: 1,
      lastMessageSender: {
        id: "",
        name: "系统",
        nickname: "",
        type: "system",
      },
      lastMessageSummary: "Alice 邀请 Bob Li 加入群聊",
      lastChoiceSeq: 0,
      lastMentionedSeq: 0,
      lastReadSeq: 0,
      memberCount: 2,
      members: [
        {
          avatar: "/assets/avatars/builtin/17.webp",
          email: "alice@example.com",
          id: "user-1",
          name: "Alice",
          nickname: "Al",
          phone: "+8613912345678",
          role: "owner",
          type: "user",
        },
        {
          avatar: "/assets/avatars/builtin/03.webp",
          email: "bob@example.com",
          id: "user-2",
          name: "Bob Li",
          nickname: "",
          phone: "+8613912345679",
          role: "member",
          type: "user",
        },
      ],
      name: "新品讨论组",
      type: "group",
      unreadCount: 0,
      visibility: "private",
    })
    expect(fetcher).toHaveBeenCalledWith("/api/client/conversations/groups", {
      body: JSON.stringify({
        app_ids: ["app-1"],
        member_ids: ["user-2"],
        name: "新品讨论组",
      }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })
  })

  it("adds user and app members to a group conversation with credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            conversation: {
              avatar: "",
              created_at: "2026-07-03T09:30:00Z",
              id: "conversation-group-1",
              member_count: 3,
              members: [
                {
                  avatar: "/assets/avatars/builtin/03.webp",
                  email: "bob@example.com",
                  id: "user-2",
                  name: "Bob Li",
                  nickname: "",
                  phone: "+8613912345679",
                  role: "member",
                  type: "user",
                },
                {
                  avatar: "/assets/apps/assistant.webp",
                  id: "app-1",
                  name: "茉莉",
                  role: "member",
                  type: "app",
                },
              ],
              name: "新品讨论组",
              type: "group",
            },
            message: null,
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    await expect(
      addGroupConversationMembers(
        "conversation-group-1",
        {
          appIds: ["app-1"],
          memberIds: ["user-2"],
        },
        fetcher
      )
    ).resolves.toMatchObject({
      conversation: {
        id: "conversation-group-1",
        memberCount: 3,
      },
      message: null,
    })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/conversations/conversation-group-1/members",
      {
        body: JSON.stringify({
          app_ids: ["app-1"],
          member_ids: ["user-2"],
        }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      }
    )
  })

  it("loads conversation messages with pagination params", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            messages: [
              {
                id: "message-12",
                conversation_id: "conversation-1",
                seq: 12,
                sender: {
                  type: "user",
                  id: "user-2",
                },
                delegated_by: {
                  type: "app",
                  id: "app-assistant",
                  name: "茉莉",
                },
                body: {
                  type: "text",
                  content: "好的，我看一下",
                },
                client_message_id: "client-message-12",
                created_at: "2026-07-03T08:00:00Z",
              },
            ],
            page: {
              limit: 20,
              oldest_seq: 12,
              newest_seq: 12,
              has_more_before: true,
              has_more_after: false,
            },
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    await expect(
      listConversationMessages(
        "conversation-1",
        {
          beforeSeq: 13,
          limit: 20,
        },
        fetcher
      )
    ).resolves.toEqual({
      messages: [
        {
          id: "message-12",
          conversationId: "conversation-1",
          seq: 12,
          sender: {
            type: "user",
            id: "user-2",
          },
          delegatedBy: {
            type: "app",
            id: "app-assistant",
            name: "茉莉",
          },
          body: {
            type: "text",
            content: "好的，我看一下",
          },
          clientMessageId: "client-message-12",
          createdAt: "2026-07-03T08:00:00Z",
          reactionVersion: 0,
          reactions: [],
        },
      ],
      page: {
        limit: 20,
        oldestSeq: 12,
        newestSeq: 12,
        hasMoreBefore: true,
        hasMoreAfter: false,
      },
    })
    expect(fetcher).toHaveBeenCalledWith(
      "/api/client/conversations/conversation-1/messages?limit=20&before_seq=13",
      {
        credentials: "include",
        method: "GET",
      }
    )
  })

  it("sends reply references for all conversation message create APIs", async () => {
    const fetcher = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              message: {
                id: "message-reply",
                conversation_id: "conversation-1",
                seq: 13,
                sender: {
                  type: "user",
                  id: "user-1",
                },
                body: {
                  type: "text",
                  content: "回复内容",
                },
                client_message_id: "client-message-reply",
                created_at: "2026-07-03T08:01:00Z",
              },
            },
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 201,
          }
        )
      )
    )

    await sendConversationTextMessage(
      "conversation-1",
      {
        clientMessageId: "client-text",
        content: "文本回复",
        replyToMessageId: "message-quoted",
      },
      fetcher
    )
    await sendConversationMarkdownMessage(
      "conversation-1",
      {
        clientMessageId: "client-markdown",
        content: "**富文本回复**",
        replyToMessageId: "message-quoted",
      },
      fetcher
    )
    await sendConversationLinkMessage(
      "conversation-1",
      {
        clientMessageId: "client-link",
        url: "https://example.com",
        replyToMessageId: "message-quoted",
      },
      fetcher
    )
    await sendConversationCardMessage(
      "conversation-1",
      {
        clientMessageId: "client-notification",
        description: "任务说明",
        replyToMessageId: "message-quoted",
        title: "任务标题",
        url: "/projects/project-1?taskId=task-1",
      },
      fetcher
    )
    await sendConversationFileMessage(
      "conversation-1",
      {
        clientMessageId: "client-file",
        file: new File(["file"], "report.txt", { type: "text/plain" }),
        replyToMessageId: "message-quoted",
      },
      fetcher
    )
    await sendConversationImageMessage(
      "conversation-1",
      {
        caption: "**图片说明**",
        captionType: "markdown",
        clientMessageId: "client-image",
        image: new File(["image"], "photo.webp", { type: "image/webp" }),
        replyToMessageId: "message-quoted",
      },
      fetcher
    )

    const textBody = JSON.parse(String(fetcher.mock.calls[0][1]?.body))
    expect(textBody.reply_to_message_id).toBe("message-quoted")
    const markdownBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body))
    expect(markdownBody.reply_to_message_id).toBe("message-quoted")
    const linkBody = JSON.parse(String(fetcher.mock.calls[2][1]?.body))
    expect(linkBody.reply_to_message_id).toBe("message-quoted")
    const notificationBody = JSON.parse(String(fetcher.mock.calls[3][1]?.body))
    expect(notificationBody).toMatchObject({
      body: {
        description: "任务说明",
        title: "任务标题",
        type: "card",
        url: "/projects/project-1?taskId=task-1",
      },
      reply_to_message_id: "message-quoted",
    })
    expect(notificationBody.body).not.toHaveProperty("action")

    const fileBody = fetcher.mock.calls[4][1]?.body
    expect(fileBody).toBeInstanceOf(FormData)
    expect((fileBody as FormData).get("reply_to_message_id")).toBe(
      "message-quoted"
    )
    const imageBody = fetcher.mock.calls[5][1]?.body
    expect(imageBody).toBeInstanceOf(FormData)
    expect((imageBody as FormData).get("reply_to_message_id")).toBe(
      "message-quoted"
    )
    expect((imageBody as FormData).get("caption")).toBe("**图片说明**")
    expect((imageBody as FormData).get("caption_type")).toBe("markdown")
  })

  it("sends and normalizes video messages with captions", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            message: {
              body: {
                caption: "**视频说明**",
                caption_type: "markdown",
                content_type: "video/mp4",
                file_id: "video-1",
                name: "demo.mp4",
                size_bytes: 1024,
                type: "video",
              },
              client_message_id: "client-video",
              conversation_id: "conversation-1",
              created_at: "2026-09-10T08:00:00Z",
              id: "message-video",
              sender: { id: "user-1", type: "user" },
              seq: 11,
            },
          },
          success: true,
        }),
        { headers: { "content-type": "application/json" }, status: 201 }
      )
    )

    const message = await sendConversationVideoMessage(
      "conversation-1",
      {
        caption: " **视频说明** ",
        captionType: "markdown",
        clientMessageId: "client-video",
        replyToMessageId: "message-quoted",
        video: new File(["video"], "demo.mp4", { type: "video/mp4" }),
      },
      fetcher
    )

    const requestBody = fetcher.mock.calls[0][1]?.body as FormData
    expect(requestBody.get("caption")).toBe("**视频说明**")
    expect(requestBody.get("caption_type")).toBe("markdown")
    expect(requestBody.get("reply_to_message_id")).toBe("message-quoted")
    expect(requestBody.get("video")).toBeInstanceOf(File)
    expect(message.body).toEqual({
      caption: "**视频说明**",
      captionType: "markdown",
      contentType: "video/mp4",
      fileId: "video-1",
      name: "demo.mp4",
      sizeBytes: 1024,
      type: "video",
    })
    expect(formatClientMessageBodySummary(message.body)).toBe("[视频] 视频说明")
  })

  it("normalizes image captions and formats markdown summaries", () => {
    const body = normalizeClientMessageBody({
      caption: "  **图片说明**  ",
      caption_type: "markdown",
      file_id: "image-1",
      height: 240,
      type: "image",
      width: 320,
    })

    expect(body).toEqual({
      caption: "**图片说明**",
      captionType: "markdown",
      fileId: "image-1",
      height: 240,
      type: "image",
      width: 320,
    })
    expect(formatClientMessageBodySummary(body)).toBe("[图片] 图片说明")
  })

  it("sends and normalizes card message messages", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            message: {
              body: {
                description: "任务说明",
                title: "任务标题",
                type: "card",
                url: "/projects/project-1?taskId=task-1",
              },
              client_message_id: "client-notification",
              conversation_id: "conversation-1",
              created_at: "2026-07-14T08:00:00Z",
              id: "message-notification",
              sender: { id: "user-1", type: "user" },
              seq: 10,
            },
          },
          success: true,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 201,
        }
      )
    )

    const message = await sendConversationCardMessage(
      "conversation-1",
      {
        clientMessageId: "client-notification",
        description: "任务说明",
        title: "任务标题",
        url: "/projects/project-1?taskId=task-1",
      },
      fetcher
    )

    expect(message.body).toEqual({
      description: "任务说明",
      title: "任务标题",
      type: "card",
      url: "/projects/project-1?taskId=task-1",
    })
  })

  it("sends an entity card reference and normalizes the generated card", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            message: {
              body: {
                description:
                  "项目：官网 · 状态：进行中 · 负责人：张三 · 截止：2026-07-20",
                title: "完成首页改版",
                type: "card",
                url: "/projects/project-1?taskId=task-1",
              },
              client_message_id: "client-entity-card",
              conversation_id: "conversation-1",
              created_at: "2026-07-14T08:00:00Z",
              id: "message-entity-card",
              sender: { id: "user-1", type: "user" },
              seq: 11,
            },
          },
          success: true,
        }),
        {
          headers: { "content-type": "application/json" },
          status: 201,
        }
      )
    )

    const message = await sendConversationEntityCardMessage(
      "conversation-1",
      {
        clientMessageId: "client-entity-card",
        entityId: "task-1",
        entityType: "task",
      },
      fetcher
    )

    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({
      body: {
        entity_id: "task-1",
        entity_type: "task",
        type: "entity_card",
      },
    })
    expect(message.body).toEqual({
      description:
        "项目：官网 · 状态：进行中 · 负责人：张三 · 截止：2026-07-20",
      title: "完成首页改版",
      type: "card",
      url: "/projects/project-1?taskId=task-1",
    })
  })

  it("normalizes reply reference details on messages", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            messages: [
              {
                id: "message-reply",
                conversation_id: "conversation-1",
                seq: 13,
                sender: {
                  type: "user",
                  id: "user-1",
                },
                body: {
                  type: "text",
                  content: "我回复一下",
                },
                client_message_id: "client-message-reply",
                created_at: "2026-07-03T08:01:00Z",
                reply_to_message_id: "message-quoted",
                reply_to: {
                  id: "message-quoted",
                  seq: 12,
                  sender: {
                    type: "user",
                    id: "user-2",
                    name: "Bob",
                  },
                  summary: "需要被引用的消息",
                },
              },
            ],
            page: {
              has_more_after: false,
              has_more_before: false,
              limit: 20,
              newest_seq: 13,
              oldest_seq: 13,
            },
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
        }
      )
    )

    await expect(
      listConversationMessages("conversation-1", {}, fetcher)
    ).resolves.toMatchObject({
      messages: [
        {
          id: "message-reply",
          replyToMessageId: "message-quoted",
          replyTo: {
            id: "message-quoted",
            seq: 12,
            sender: {
              id: "user-2",
              name: "Bob",
              type: "user",
            },
            summary: "需要被引用的消息",
          },
        },
      ],
    })
  })

  it("normalizes revoked messages without exposing the original body", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            messages: [
              {
                id: "message-revoked",
                conversation_id: "conversation-1",
                seq: 12,
                sender: {
                  type: "user",
                  id: "user-2",
                },
                client_message_id: "client-message-revoked",
                created_at: "2026-07-03T08:00:00Z",
                revoked_at: "2026-07-03T08:02:00Z",
                revoked_by_user_id: "user-2",
              },
            ],
            page: {
              limit: 20,
              oldest_seq: 12,
              newest_seq: 12,
              has_more_before: false,
              has_more_after: false,
            },
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    await expect(
      listConversationMessages("conversation-1", {}, fetcher)
    ).resolves.toEqual({
      messages: [
        {
          id: "message-revoked",
          conversationId: "conversation-1",
          seq: 12,
          sender: {
            type: "user",
            id: "user-2",
          },
          body: {
            type: "revoked",
          },
          clientMessageId: "client-message-revoked",
          createdAt: "2026-07-03T08:00:00Z",
          revokedAt: "2026-07-03T08:02:00Z",
          revokedByUserId: "user-2",
          reactionVersion: 0,
          reactions: [],
        },
      ],
      page: {
        hasMoreAfter: false,
        hasMoreBefore: false,
        limit: 20,
        newestSeq: 12,
        oldestSeq: 12,
      },
    })
  })

  it("normalizes an editable body returned for an own revoked message", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            messages: [
              {
                id: "message-revoked",
                conversation_id: "conversation-1",
                seq: 12,
                sender: {
                  type: "user",
                  id: "user-1",
                },
                created_at: "2026-07-03T08:00:00Z",
                revoked_at: "2026-07-03T08:02:00Z",
                revoked_by_user_id: "user-1",
                editable_body: {
                  content: "重新编辑这条消息",
                  type: "text",
                },
              },
            ],
            page: {
              limit: 20,
              oldest_seq: 12,
              newest_seq: 12,
              has_more_before: false,
              has_more_after: false,
            },
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 200,
        }
      )
    )

    const result = await listConversationMessages("conversation-1", {}, fetcher)

    expect(result.messages[0]?.body).toEqual({
      editableBody: {
        content: "重新编辑这条消息",
        type: "text",
      },
      type: "revoked",
    })
  })

  it("keeps message history available when one message body is unsupported", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            messages: [
              {
                id: "message-unsupported",
                conversation_id: "conversation-1",
                seq: 12,
                sender: { type: "user", id: "user-2" },
                body: { type: "future_message", payload: { value: 1 } },
                client_message_id: "client-message-unsupported",
                created_at: "2026-07-03T08:00:00Z",
              },
              {
                id: "message-malformed",
                conversation_id: "conversation-1",
                seq: 13,
                sender: { type: "user", id: "user-2" },
                body: {
                  type: "card",
                  title: "缺少地址字段的卡片",
                  description: "不完整消息",
                },
                client_message_id: "client-message-malformed",
                created_at: "2026-07-03T08:01:00Z",
              },
              {
                id: "message-supported",
                conversation_id: "conversation-1",
                seq: 14,
                sender: { type: "user", id: "user-2" },
                body: { type: "text", content: "后续正常消息" },
                client_message_id: "client-message-supported",
                created_at: "2026-07-03T08:02:00Z",
              },
            ],
            page: {
              limit: 20,
              oldest_seq: 12,
              newest_seq: 14,
              has_more_before: false,
              has_more_after: false,
            },
          },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        }
      )
    )

    await expect(
      listConversationMessages("conversation-1", {}, fetcher)
    ).resolves.toMatchObject({
      messages: [
        {
          id: "message-unsupported",
          body: { type: "unsupported" },
        },
        {
          id: "message-malformed",
          body: { type: "unsupported" },
        },
        {
          id: "message-supported",
          body: { type: "text", content: "后续正常消息" },
        },
      ],
    })
  })

  it("normalizes an unsupported realtime message body without dropping the event", () => {
    expect(
      normalizeMessageCreatedEventPayload({
        message: {
          id: "message-realtime-unsupported",
          conversation_id: "conversation-1",
          seq: 15,
          sender: { type: "user", id: "user-2" },
          body: { type: "future_message", payload: "unknown" },
          client_message_id: "client-realtime-unsupported",
          created_at: "2026-07-03T08:03:00Z",
        },
      })
    ).toMatchObject({
      id: "message-realtime-unsupported",
      body: { type: "unsupported" },
    })
  })

  it("normalizes and summarizes friendship system events", () => {
    const friendship = normalizeClientMessageBody({
      event: "friendship_created",
      type: "system_event",
    })

    expect(friendship).toEqual({
      event: "friendship_created",
      type: "system_event",
    })
    expect(formatClientMessageBodySummary(friendship)).toBe(
      "你们已成为好友，现在可以开始聊天了"
    )
  })

  it("normalizes and summarizes group announcement system events", () => {
    const updated = normalizeClientMessageBody({
      actor: { display_name: "Alice", id: "user-1" },
      announcement: "本周五发布",
      event: "group_announcement_updated",
      type: "system_event",
    })
    expect(updated).toEqual({
      actor: { displayName: "Alice", id: "user-1" },
      announcement: "本周五发布",
      event: "group_announcement_updated",
      type: "system_event",
    })
    expect(formatClientMessageBodySummary(updated)).toBe("Alice 更新了群公告")

    const cleared = normalizeClientMessageBody({
      actor: { display_name: "Alice", id: "user-1" },
      announcement: "",
      event: "group_announcement_updated",
      type: "system_event",
    })
    expect(formatClientMessageBodySummary(cleared)).toBe("Alice 清空了群公告")
  })

  it("throws a typed unauthorized error", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: "unauthorized",
            message: "未登录",
          },
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 401,
        }
      )
    )

    await expect(getCurrentClientUser(fetcher)).rejects.toMatchObject({
      code: "unauthorized",
      message: "未登录",
      name: "ClientDataRequestError",
      status: 401,
    } satisfies ClientDataRequestError)
  })
})
