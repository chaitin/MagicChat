import { describe, expect, it } from "vitest"

import {
  createDraftFromMessageContent,
  createDraftMentionTemplate,
} from "@/lib/conversation-composer"

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
