import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import * as images from "../src/shared/task-image.ts"
import { ProjectTaskManager } from "../src/main/account/project-task-manager.ts"

const scope = { targetId: "account", projectId: "project", taskId: "task" }
const actor = { id: "u1", name: "王明", nickname: "", avatar: "" }
const activity = {
  id: "comment",
  project_id: scope.projectId,
  task_id: scope.taskId,
  actor,
  type: "commented",
  content: "**已检查**\n![截图](attachment:file-1)",
  changes: [],
  created_at: "2026-11-05T12:00:00Z",
}
const task = {
  id: scope.taskId,
  title: "发布任务",
  description: "**任务正文**",
  labels: [],
  status: "todo",
  priority: 2,
  creator: actor,
  assignee: null,
  createdAt: activity.created_at,
  updatedAt: activity.created_at,
}
function compile(path: string, append = "") {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8") + append, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
}
const detail = compile(
  "../src/renderer/features/projects/project-task-detail-view.tsx",
  "\nexport { TaskActivitySection }\n",
)
const editor = compile("../src/renderer/features/projects/task-description-editor.tsx")
const jsx = (type: any, props: any, key?: any) => ({ type, props, key })
const runtime = { jsx, jsxs: jsx, Fragment: "Fragment" }
function nodes(node: any): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!node || typeof node !== "object") return []
  return [node, ...nodes(node.props?.children)]
}
const find = (root: any, type: any) => nodes(root).find((node) => node.type === type)
function textContent(node: any): string {
  if (Array.isArray(node)) return node.map(textContent).join("")
  if (node == null || typeof node === "boolean") return ""
  return typeof node === "object" ? textContent(node.props?.children) : String(node)
}
function deferred() {
  let resolve!: (value: any) => void, reject!: (reason: Error) => void
  const promise = new Promise<any>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function mount(
  t: test.TestContext,
  code: string,
  name: string,
  props: () => any,
  accountData: any = {},
) {
  let cursor = 0,
    dirty = true,
    mounted = true,
    root: any
  const slots = new Map<number, any>()
  const effects = new Map<number, { deps: any[]; cleanup?: () => void }>()
  let pending: Array<() => void> = []
  const document = { activeElement: null as any }
  const input = {
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange(start: number, end: number) {
      this.selectionStart = start
      this.selectionEnd = end
    },
  }
  const useEffect = (run: () => any, deps: any[]) => {
    const index = cursor++,
      previous = effects.get(index)
    if (
      previous &&
      deps.length === previous.deps.length &&
      deps.every((value, index) => Object.is(value, previous.deps[index]))
    )
      return
    pending.push(() => {
      previous?.cleanup?.()
      effects.set(index, { deps, cleanup: run() })
    })
  }
  const react = {
    useState: (initial: any) => {
      const index = cursor++
      if (!slots.has(index)) slots.set(index, typeof initial === "function" ? initial() : initial)
      return [
        slots.get(index),
        (next: any) => {
          if (!mounted) return
          const value = typeof next === "function" ? next(slots.get(index)) : next
          if (!Object.is(value, slots.get(index))) {
            slots.set(index, value)
            dirty = true
          }
        },
      ]
    },
    useRef: (value: any) => {
      const index = cursor++
      if (!slots.has(index)) slots.set(index, { current: value })
      return slots.get(index)
    },
    useId: () => {
      cursor++
      return "markdown-editor"
    },
    useCallback: (callback: any) => {
      cursor++
      return callback
    },
    useEffect,
    useLayoutEffect: useEffect,
  }
  const module = { exports: {} as any }
  runInNewContext(code, {
    module,
    exports: module.exports,
    document,
    crypto: { randomUUID },
    window: { taskWindow: { accountData } },
    require: (name: string) => {
      if (name === "react") return react
      if (name === "react/jsx-runtime") return runtime
      if (name === "../../../shared/task-image") return images
      return new Proxy({}, { get: (_target, key) => key })
    },
  })
  function render() {
    cursor = 0
    dirty = false
    pending = []
    root = module.exports[name](props())
    const textarea = find(root, "Textarea")
    if (textarea) {
      input.value = textarea.props.value
      textarea.props.ref.current = input
      document.activeElement = input
    }
    for (const run of pending) run()
  }
  async function flush() {
    if (mounted) render()
    for (let turn = 0; turn < 25; turn++) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (!dirty || !mounted) return
      render()
    }
    assert.fail("组件状态未收敛")
  }
  function unmount() {
    if (!mounted) return
    mounted = false
    for (const effect of effects.values()) effect.cleanup?.()
  }
  t.after(unmount)
  render()
  return {
    flush,
    unmount,
    input,
    get root() {
      return root
    },
  }
}

function section(
  t: test.TestContext,
  options: { activities?: any[]; post?: (input: any) => any; renderAttachmentImage?: any } = {},
) {
  const posts: any[] = []
  let changed = 0,
    lists = 0
  const renderAttachmentImage =
    options.renderAttachmentImage ??
    ((fileId: string, alt: string) => jsx("TaskAttachmentImage", { ...scope, fileId, alt }))
  const component = mount(
    t,
    detail,
    "TaskActivitySection",
    () => ({
      ...scope,
      members: [],
      revision: 0,
      renderAttachmentImage,
      onChanged: async () => {
        changed++
      },
    }),
    {
      listProjectTaskActivities: async () => {
        lists++
        return { ok: true, data: { items: options.activities ?? [], nextCursor: null } }
      },
      addProjectTaskComment: async (input: any) => {
        posts.push(input)
        return options.post?.(input) ?? { ok: true, data: activity }
      },
    },
  )
  return {
    ...component,
    posts,
    get root() {
      return component.root
    },
    get composer() {
      return find(component.root, "TaskDescriptionEditor")
    },
    get submit() {
      return nodes(find(component.root, "TaskDescriptionEditor").props.footer).find(
        (node) => node.type === "Button" && node.props.type === "submit",
      )
    },
    get changed() {
      return changed
    },
    get lists() {
      return lists
    },
    write: (value: string) =>
      find(component.root, "TaskDescriptionEditor").props.onChange(() => value),
    send: () => find(component.root, "form").props.onSubmit({ preventDefault() {} }),
  }
}

test("评论复用正文编辑器，并把Markdown和图片原文提交到当前任务", async (t) => {
  const f = section(t)
  await f.flush()
  assert.equal(f.composer.props.label, "评论内容")
  assert.equal(f.composer.props.hideLabel, true)
  assert.ok(f.composer.props.footer)
  assert.equal(
    nodes(f.root).filter((node) => node.type === "Button" && node.props.type === "submit").length,
    0,
  )
  assert.equal(f.composer.props.taskId, scope.taskId)
  f.write(activity.content)
  await f.flush()
  assert.equal(f.submit.props.disabled, false)
  f.send()
  await f.flush()
  assert.deepEqual(JSON.parse(JSON.stringify(f.posts)), [{ ...scope, content: activity.content }])
  assert.equal(f.composer.props.value, "")
  assert.equal(f.composer.key, 1)
  assert.equal(f.changed, 1)
  assert.equal(f.lists, 2)
})

test("图片待上传、上传失败占位和空白评论不能发送", async (t) => {
  const f = section(t)
  for (const value of ["   \n", "![截图](task-upload:upload-1)"]) {
    f.write(value)
    await f.flush()
    assert.equal(f.submit.props.disabled, true)
    f.send()
    await f.flush()
  }
  assert.equal(f.posts.length, 0)
  assert.equal(f.composer.key, 0)
})

test("发送失败保留Markdown、图片草稿和编辑器状态；可以重试", async (t) => {
  let fail = true
  const f = section(t, {
    post: () =>
      fail ? { ok: false, error: { message: "发送失败" } } : { ok: true, data: activity },
  })
  await f.flush()
  f.write(activity.content)
  await f.flush()
  f.send()
  await f.flush()
  assert.equal(f.composer.props.value, activity.content)
  assert.equal(f.composer.key, 0)
  assert.match(textContent(f.root), /发送失败/)
  fail = false
  f.send()
  await f.flush()
  assert.equal(f.posts.length, 2)
  assert.equal(f.composer.props.value, "")
})

test("发送中禁用编辑器并阻止重复提交，超长评论不请求接口", async (t) => {
  const pending = deferred()
  const f = section(t, { post: () => pending.promise })
  await f.flush()
  f.write("x".repeat(10001))
  await f.flush()
  f.send()
  await f.flush()
  assert.equal(f.posts.length, 0)
  assert.match(textContent(f.root), /10000/)
  f.write("**发送中**")
  await f.flush()
  f.send()
  await f.flush()
  assert.equal(f.composer.props.disabled, true)
  f.send()
  await f.flush()
  assert.equal(f.posts.length, 1)
  pending.resolve({ ok: true, data: activity })
  await f.flush()
  assert.equal(f.composer.props.disabled, false)
})

test("旧文本和新评论均使用正文同款渲染器，创建/更新动态仍是普通文本", async (t) => {
  const renderAttachmentImage = (fileId: string, alt: string) =>
    jsx("TaskAttachmentImage", { ...scope, fileId, alt })
  const f = section(t, {
    renderAttachmentImage,
    activities: [
      { ...activity, id: "old", content: "旧评论\n第二行" },
      { ...activity, id: "new", content: activity.content },
      { ...activity, id: "created", type: "created", content: "", changes: [] },
      { ...activity, id: "updated", type: "updated", content: "", changes: [] },
    ],
  })
  await f.flush()
  const rendered = nodes(f.root).filter((node) => node.type === "MessageMarkdown")
  assert.equal(rendered.length, 2)
  assert.equal(rendered[0].props.content, "旧评论\n第二行")
  assert.equal(rendered[1].props.content, activity.content)
  assert.equal(rendered[1].props.renderAttachmentImage, renderAttachmentImage)
  assert.equal(rendered[1].props.renderAttachmentImage("file-1", "截图").props.taskId, scope.taskId)
  assert.match(textContent(f.root), /创建了任务/)
  assert.match(textContent(f.root), /更新了任务/)
})

test("正文和评论共享同一个图片渲染回调与任务权限上下文", (t) => {
  const f = mount(t, detail, "ProjectTaskDetailView", () => ({
    targetId: scope.targetId,
    projectId: scope.projectId,
    task,
    members: [],
    theme: "light",
    onChanged: async () => {},
    onEdit() {},
    onDelete() {},
    disabled: false,
    propertyControls: null,
    activityRevision: 0,
  }))
  const body = find(f.root, "MessageMarkdown")
  const comments = nodes(f.root).find(
    (node) => typeof node.type === "function" && node.type.name === "TaskActivitySection",
  )
  assert.equal(comments.props.renderAttachmentImage, body.props.renderAttachmentImage)
  const image = body.props.renderAttachmentImage("file-1", "截图")
  assert.equal(image.type, "TaskAttachmentImage")
  for (const [key, value] of Object.entries(scope)) assert.equal(image.props[key], value)
})

function editorFixture(t: test.TestContext, upload: (input: any) => Promise<any>, initial = "") {
  let value = initial
  const calls: any[] = []
  const f = mount(
    t,
    editor,
    "TaskDescriptionEditor",
    () => ({
      ...scope,
      value,
      disabled: false,
      label: "评论内容",
      hideLabel: true,
      onChange: (update: (current: string) => string) => {
        value = update(value)
      },
    }),
    {
      uploadProjectTaskImage: (input: any) => {
        calls.push(input)
        return upload(input)
      },
    },
  )
  return {
    ...f,
    calls,
    get root() {
      return f.root
    },
    get value() {
      return value
    },
    paste: (file: any) => {
      f.input.selectionStart = f.input.selectionEnd = f.input.value.length
      let prevented = false
      find(f.root, "Textarea").props.onPaste({
        currentTarget: f.input,
        preventDefault() {
          prevented = true
        },
        clipboardData: {
          items: [{ kind: "file", type: file.type, getAsFile: () => file }],
          files: [file],
        },
      })
      return prevented
    },
  }
}
const png = {
  name: "截图.png",
  type: "image/png",
  size: 8,
  arrayBuffer: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer,
}

test("发送按钮位于编辑器同一边框内的右下角，原文和预览均为内容保留独立空间", async (t) => {
  const action = jsx("Button", { type: "submit", children: "发送" })
  const f = mount(t, editor, "TaskDescriptionEditor", () => ({
    ...scope,
    value: "**评论**",
    disabled: false,
    label: "评论内容",
    hideLabel: true,
    footer: action,
    onChange() {},
  }))
  for (const preview of [false, true]) {
    if (preview) {
      nodes(f.root)
        .find((node) => node.type === "Button" && node.props.children === "预览")
        .props.onClick()
      await f.flush()
    }
    const row = nodes(f.root).find((node) => node.type === "div" && node.props.children === action)
    assert.ok(row)
    assert.match(row.props.className, /justify-end/)
    assert.doesNotMatch(row.props.className, /absolute/)
    const frame = nodes(f.root).find(
      (node) =>
        node.type === "div" &&
        node.props.className?.includes("border-input") &&
        nodes(node).includes(row),
    )
    assert.ok(frame)
    assert.match(frame.props.className, /flex-col/)
    if (preview) assert.equal(find(frame, "MessageMarkdown").props.content, "**评论**")
    else assert.match(find(frame, "Textarea").props.className, /border-0/)
  }
})

test("实际编辑器粘贴图片复用任务上传，成功后用附件ID替换占位并支持预览", async (t) => {
  const pending = deferred()
  const f = editorFixture(t, () => pending.promise, "**检查结果**")
  assert.equal(find(f.root, "label").props.className, "sr-only")
  assert.equal(find(f.root, "Textarea").props["aria-label"], "评论内容")
  assert.equal(f.paste(png), true)
  await f.flush()
  assert.equal(images.hasTaskImageUpload(f.value), true)
  assert.equal(f.calls.length, 1)
  for (const [key, value] of Object.entries(scope)) assert.equal(f.calls[0][key], value)
  assert.equal(f.calls[0].contentType, "image/png")
  pending.resolve({ ok: true, data: { fileId: "file-1", sizeBytes: 8 } })
  await f.flush()
  assert.equal(images.hasTaskImageUpload(f.value), false)
  assert.match(f.value, /attachment:file-1/)
  assert.match(f.value, /\*\*检查结果\*\*/)
  const preview = nodes(f.root).find(
    (node) => node.type === "Button" && node.props.children === "预览",
  )
  preview.props.onClick()
  await f.flush()
  const markdown = find(f.root, "MessageMarkdown")
  assert.equal(markdown.props.content, f.value)
  assert.equal(markdown.props.renderAttachmentImage("file-1", "截图").props.taskId, scope.taskId)
})

test("实际贴图失败可重试，移除失败图片不会丢失原评论", async (t) => {
  let fails = true
  const f = editorFixture(
    t,
    async () =>
      fails
        ? { ok: false, error: { message: "上传失败" } }
        : { ok: true, data: { fileId: "file-1", sizeBytes: 8 } },
    "保留文字",
  )
  f.paste(png)
  await f.flush()
  assert.ok(images.hasTaskImageUpload(f.value))
  const retry = nodes(f.root).find(
    (node) => node.type === "Button" && node.props.children === "重试",
  )
  assert.ok(retry)
  fails = false
  retry.props.onClick()
  await f.flush()
  assert.equal(f.calls.length, 2)
  assert.match(f.value, /attachment:file-1/)
  const failed = editorFixture(
    t,
    async () => ({ ok: false, error: { message: "上传失败" } }),
    "保留文字",
  )
  failed.paste(png)
  await failed.flush()
  const remove = nodes(failed.root).find((node) =>
    node.props?.["aria-label"]?.startsWith("移除图片"),
  )
  remove.props.onClick()
  await failed.flush()
  assert.equal(images.hasTaskImageUpload(failed.value), false)
  assert.match(failed.value, /保留文字/)
})

test("贴图超过评论上限时不上传；默认正文编辑器标签和行为保持不变", async (t) => {
  const f = editorFixture(t, async () => assert.fail("不应上传"), "x".repeat(9999))
  f.paste(png)
  await f.flush()
  assert.equal(f.calls.length, 0)
  assert.equal(f.value.length, 9999)
  assert.match(textContent(f.root), /评论内容不能超过 10000/)
  const body = mount(t, editor, "TaskDescriptionEditor", () => ({
    ...scope,
    value: "",
    disabled: false,
    onChange() {},
  }))
  assert.equal(find(body.root, "Textarea").props["aria-label"], "详细说明")
  assert.notEqual(find(body.root, "label").props.className, "sr-only")
})

test("评论主进程保留Markdown和附件引用，支持10000字符并拒绝未完成图片", async () => {
  const posts: any[] = []
  const manager = new ProjectTaskManager({
    post: async (path: string, payload: any) => {
      posts.push({ path, payload })
      return { ...activity, content: payload.content }
    },
  } as never)
  const saved = await manager.addComment({ ...scope, content: activity.content })
  assert.equal(saved.content, activity.content)
  assert.equal(posts[0].path, "/api/client/projects/project/tasks/task/comments")
  assert.equal(posts[0].payload.content, activity.content)
  assert.equal(
    (await manager.addComment({ ...scope, content: "x".repeat(10000) })).content.length,
    10000,
  )
  for (const content of ["", " \n", "x".repeat(10001), "![截图](task-upload:upload-1)"])
    await assert.rejects(manager.addComment({ ...scope, content }))
  assert.equal(posts.length, 2)
})
