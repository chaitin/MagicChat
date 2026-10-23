import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { parseContactLink } from "../../shared/contact-links.ts"

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8")

test("名片发送请求携带实体引用和稳定请求ID，返回服务端普通卡片", async () => {
  const code = source("data/messages/messages-api.ts")
  const ast = ts.createSourceFile("api.ts", code, ts.ScriptTarget.Latest, true)
  const declaration = ast.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "sendConversationEntityCardMessage",
  )!
  const js = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const seen: { path: string; body: Record<string, unknown> }[] = []
  const target = { id: "server", userId: "user" }
  const message = {
    body: { type: "card", url: "jiying://app/550e8400-e29b-41d4-a716-446655440000" },
  }
  const exports = {} as {
    sendConversationEntityCardMessage: (
      target: unknown,
      id: string,
      input: unknown,
    ) => Promise<unknown>
  }
  runInNewContext(js, {
    exports,
    ApiRequestError: Error,
    normalizeClientMessage: (value: unknown) => value,
    createProtectedApiClient: (actual: unknown) => {
      assert.equal(actual, target)
      return {
        request: async (path: string, options: { body: string; method: string }) => {
          assert.equal(options.method, "POST")
          seen.push({ path, body: JSON.parse(options.body) })
          return { message }
        },
      }
    },
  })
  for (const entityType of ["user", "app", "group"]) {
    assert.equal(
      await exports.sendConversationEntityCardMessage(target, "conversation", {
        clientMessageId: "stable-id",
        entityType,
        entityId: "entity-id",
      }),
      message,
    )
    assert.deepEqual(seen.at(-1), {
      path: "/api/client/conversations/conversation/messages",
      body: {
        client_message_id: "stable-id",
        body: { type: "entity_card", entity_type: entityType, entity_id: "entity-id" },
      },
    })
  }
})

test("推荐给好友渲染StudentCardIcon，并与发消息图标的大小、颜色和线宽一致", async () => {
  const { default: StudentCardIcon } = await import("@hugeicons/core-free-icons/dist/esm/StudentCardIcon")
  const code = source("features/entity-details/send-namecard-action.tsx")
  const ast = ts.createSourceFile("action.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const component = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "SendNamecardAction")!
  const compiled = ts.transpileModule(`export ${component.getText(ast)}`, {
    fileName: "action.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText
  type Element = { type: string; props: Record<string, unknown>; children: Element[] }
  const exports = {} as { SendNamecardAction: (input: unknown) => Element }
  runInNewContext(compiled, {
    exports, StudentCardIcon, Svg: "Svg", Path: "Path", XGUIListItem: "XGUIListItem",
    React: { Fragment: "Fragment", createElement: (type: string, props: Record<string, unknown>, ...children: Element[]) => ({ type, props, children }) },
    useAuthenticatedSession: () => ({}), useAuth: () => ({ generation: 1 }), useRouter: () => ({ push() {} }),
    useXGUIToast: () => ({}), useXGUITheme: () => ({ colors: { link: "#123456" } }),
    useState: (value: unknown) => [value, () => {}], useRef: (value: unknown) => ({ current: value }), useEffect: () => {},
  })
  const row = exports.SendNamecardAction({ target: { type: "user", id: "user-id" } })
  assert.equal(row.props.title, "推荐给好友")
  const icon = row.props.leading as Element
  assert.equal(icon.type, "Svg")
  assert.equal(icon.props.width, 26)
  assert.equal(icon.props.height, 26)
  assert.equal(icon.props.accessible, false)
  const paths = icon.children[0] as unknown as Element[]
  assert.equal(paths.length, StudentCardIcon.length)
  paths.forEach((path, index) => {
    assert.equal(path.props.d, StudentCardIcon[index][1].d)
    assert.equal(path.props.stroke, "#123456")
    assert.equal(path.props.strokeWidth, 1)
  })
})

test("三类消息气泡名片进入资料导航，不交给操作系统打开", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000"
  assert.deepEqual(parseContactLink(`jiying://contact/${id}`), { type: "user", id })
  assert.deepEqual(parseContactLink(`jiying://app/${id}`), { type: "app", id })
  assert.deepEqual(parseContactLink(`jiying://group/${id}`), { type: "group", id })
  const body = source("features/conversation/messages/message-body.tsx")
  assert.match(body, /parseContactLink\(body.url\)[\s\S]*?if \(target\) onMentionPress\(target\)/)
})

test("推荐给好友位于主操作上方且使用独立列表，进入发送名片页面",  () => {
  const action = source("features/entity-details/entity-detail-action.tsx")
  const ast = ts.createSourceFile("action.tsx", action, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const syntax = ts.transpileModule(action, {
    fileName: "action.tsx",
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX },
  })
  assert.deepEqual(syntax.diagnostics?.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")), [])
  const lists: ts.JsxElement[] = []
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "XGUIList") lists.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(lists.length, 2)
  assert.match(lists[0].getText(ast), /<SendNamecardAction/)
  assert.doesNotMatch(lists[0].getText(ast), /<XGUIListItem/)
  assert.match(lists[1].getText(ast), /<XGUIListItem/)
  assert.doesNotMatch(lists[1].getText(ast), /<SendNamecardAction/)
  const send = source("features/entity-details/send-namecard-action.tsx")
  assert.match(send, /accessibilityLabel="推荐给好友"/)
  assert.match(send, /title="推荐给好友"/)
  assert.match(send, /router.push\(buildSendTargetHref\(session, generation, \{ purpose: "namecard", entity: target \}\)\)/)
  assert.doesNotMatch(send, /ForwardMessageSheet|mountedSheet/)
  const sender = source("features/send-to/use-send-to-conversations.ts")
  assert.match(sender, /messageManager.writeMessages\(session, \[sent\]\)/)
})
