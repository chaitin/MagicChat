import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  countReportDescriptionCharacters,
  limitReportDescription,
} from "../src/data/reports/report-text.ts"

const detailsScreen = await readFile(
  new URL(
    "../src/features/conversation-details/conversation-details-screen.tsx",
    import.meta.url
  ),
  "utf8"
)
const reportScreen = await readFile(
  new URL(
    "../src/features/conversation-report/conversation-report-screen.tsx",
    import.meta.url
  ),
  "utf8"
)
const reportApi = await readFile(
  new URL("../src/data/reports/reports-api.ts", import.meta.url),
  "utf8"
)

test("仅私聊详情显示独立举报入口", () => {
  assert.match(
    detailsScreen,
    /conversation\.type === "direct" && directContactId[\s\S]*?title="举报"/
  )
  assert.match(detailsScreen, /buildConversationReportHref\(conversationId\)/)
})

test("举报原型包含举报原因、用户和描述", () => {
  assert.match(reportScreen, /const DESCRIPTION_MAX_LENGTH = 500/)
  assert.match(
    reportScreen,
    /title="举报原因" variant="form-radio"/
  )
  assert.match(
    reportScreen,
    /title="举报用户" variant="form-radio"/
  )
  assert.match(reportScreen, /reasonSelect: \{[\s\S]*?minHeight: 56/)
  assert.match(reportScreen, /<ChevronRight[\s\S]*?size=\{20\}/)
  assert.match(reportScreen, /title="举报用户"/)
  assert.match(reportScreen, /accessibilityLabel="举报描述"/)
  assert.match(reportScreen, /descriptionInput: \{[\s\S]*?height: 80/)
  assert.match(reportScreen, /count: \{[\s\S]*?fontSize: 14/)
  assert.match(
    reportScreen,
    /const canSubmit = Boolean\(target && reason && description\.trim\(\)\)/
  )
  assert.match(
    reportScreen,
    /disabled=\{!canSubmit \|\| createReportMutation\.isPending\}/
  )
  assert.match(reportScreen, /提交举报/)
  assert.doesNotMatch(reportScreen, /证据图片|MediaLibrary|media-picker/)
})

test("举报提交接入真实接口并提供加载和结果反馈", () => {
  assert.match(reportScreen, /createReportMutation\.mutateAsync/)
  assert.match(reportScreen, /举报已提交，我们将在 24 小时内处理/)
  assert.match(reportScreen, /loading=\{createReportMutation\.isPending\}/)
  assert.match(reportScreen, /if \(submittingRef\.current\) return/)
  assert.match(reportScreen, /submittingRef\.current = true/)
  assert.match(reportApi, /\/api\/client\/conversations\/\$\{encodeURIComponent\(input\.conversationId\)\}\/reports/)
  assert.match(reportApi, /reason: input\.reason/)
  assert.match(reportApi, /description: input\.description\.trim\(\)/)
})

test("举报描述按 Unicode 码点限制为 500 字符", () => {
  const emojiDescription = "😀".repeat(500)
  assert.equal(countReportDescriptionCharacters(emojiDescription), 500)
  assert.equal(
    countReportDescriptionCharacters(
      limitReportDescription(`${emojiDescription}😀`, 500)
    ),
    500
  )
})
