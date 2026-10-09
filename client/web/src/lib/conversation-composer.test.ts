import { describe, expect, it } from "vitest"

import {
  createDraftFromMessageContent,
  createDraftMentionTemplate,
  createMentionCandidates,
} from "@/lib/conversation-composer"
import type { ClientConversationMember } from "@/lib/client-data-api"

it("non-group mentions omit everyone while keeping the assistant name from members", () => {
  const member = {
    id: "00000000-0000-0000-0000-000000000001",
    type: "app",
    name: "自定义助理名",
    nickname: "",
    avatar: "",
    email: "",
    phone: "",
  } as ClientConversationMember
  expect(createMentionCandidates([member], false).map(({ id, label }) => ({ id, label }))).toEqual([
    { id: member.id, label: member.name },
  ])
  expect(createMentionCandidates([], false).map(({ id, label }) => ({ id, label }))).toEqual([
    { id: member.id, label: "茉莉" },
  ])
})

describe("createDraftFromMessageContent", () => {
  it("restores mention labels and preserves their tokens when sent again", () => {
    const content =
      "你好 {(@user/123e4567-e89b-12d3-a456-426614174000)}，请再看一下"
    const draft = createDraftFromMessageContent(content, () => "李四")

    expect(draft).toEqual({
      mentions: [
        {
          end: 6,
          id: "123e4567-e89b-12d3-a456-426614174000",
          label: "李四",
          start: 3,
          targetType: "user",
        },
      ],
      text: "你好 @李四，请再看一下",
    })
    expect(createDraftMentionTemplate(draft.text, draft.mentions)).toBe(content)
  })
})
