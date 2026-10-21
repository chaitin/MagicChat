import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { parseContactLink } from "../../shared/contact-links.ts"

test("桌面端三类名片派发当前账号的资料导航，不打开浏览器", () => {
  const text = readFileSync(
    new URL("../src/renderer/features/chat/message-bodies/rich-body.tsx", import.meta.url),
    "utf8",
  )
  const ast = ts.createSourceFile("body.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "CardBody",
  )!
  const code = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
    },
  }).outputText
  const events: { type: string; detail: unknown }[] = []
  const errors: unknown[] = []
  let external = 0
  const exports = {} as { CardBody: (input: unknown) => { props: { onClick: () => void } } }
  runInNewContext(code, {
    exports,
    parseContactLink,
    openContactEvent: "open-contact",
    useAnimatedToast: () => ({ showToast: (error: unknown) => errors.push(error) }),
    React: { createElement: (_tag: unknown, props: unknown) => ({ props }) },
    CustomEvent: class {
      type: string
      detail: unknown
      constructor(type: string, options: { detail: unknown }) {
        this.type = type
        this.detail = options.detail
      }
    },
    window: {
      dispatchEvent: (event: (typeof events)[number]) => events.push(event),
      desktop: {
        openWebLink: async () => {
          external++
          return { ok: true }
        },
      },
    },
  })
  const id = "550e8400-e29b-41d4-a716-446655440000"
  for (const [kind, type] of [
    ["contact", "user"],
    ["app", "app"],
    ["group", "group"],
  ]) {
    exports
      .CardBody({
        title: "Name",
        description: "Info",
        url: `jiying://${kind}/${id}`,
        targetId: "account",
      })
      .props.onClick()
    assert.equal(
      JSON.stringify(events.at(-1)),
      JSON.stringify({
        type: "open-contact",
        detail: { targetId: "account", target: { type, id } },
      }),
    )
  }
  exports
    .CardBody({ title: "Bad", description: "", url: "jiying://task/invalid", targetId: "account" })
    .props.onClick()
  assert.equal(events.length, 3)
  assert.equal(errors.length, 1)
  assert.equal(external, 0)
})

test("推荐给好友复用修改资料的secondary动效按钮，并位于主操作下方", () => {
  const button = readFileSync(
    new URL("../src/renderer/components/send-namecard-button.tsx", import.meta.url),
    "utf8",
  )
  assert.match(button, /import { Button } from "@\/components\/motion\/button\/base"/)
  assert.match(button, /variant="secondary"/)
  assert.match(button, /推荐给好友/)
  const page = readFileSync(
    new URL("../src/renderer/features/contacts/contacts-page.tsx", import.meta.url),
    "utf8",
  )
  const details = page.slice(page.indexOf("function ContactDetails("))
  assert.ok(
    details.indexOf("onClick={onAddFriend ?? onMessage}") < details.indexOf("<SendNamecardButton"),
  )
  assert.ok(details.indexOf("<SendNamecardButton") < details.indexOf("修改资料"))
  const popover = readFileSync(
    new URL("../src/renderer/components/avatar/contact-profile-popover.tsx", import.meta.url),
    "utf8",
  )
  assert.ok(
    popover.indexOf("onClick={() => void handleAction()}") < popover.indexOf("<SendNamecardButton"),
  )
})
