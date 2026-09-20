import { useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAnimatedToast } from "@/components/motion/animated-toast-provider"
import type {
  ClientAppVisibility,
  DesktopClientAppCredentials,
  DesktopContactUser,
} from "../../../shared/account-data"

export function ClientAppDialog({
  mode,
  targetId,
  users,
  credentials,
  onClose,
  onChanged,
  onDeleted,
}: {
  mode: "create" | "edit" | "credentials"
  targetId: string
  users: DesktopContactUser[]
  credentials: DesktopClientAppCredentials | null
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const { showToast } = useAnimatedToast()
  const [name, setName] = useState(credentials?.app.name ?? "")
  const [description, setDescription] = useState(credentials?.app.description ?? "")
  const [visibility, setVisibility] = useState<ClientAppVisibility>(
    credentials?.app.visibility ?? "creator",
  )
  const [userIds, setUserIds] = useState<string[]>(credentials?.app.userIds ?? [])
  const [secret, setSecret] = useState(credentials?.connectionSecret ?? "")
  const [createdCredentials, setCreatedCredentials] = useState<DesktopClientAppCredentials | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const accessCredentials = createdCredentials ?? credentials
  if ((mode === "credentials" || createdCredentials) && accessCredentials)
    return (
      <Modal title="开发指南" onClose={onClose}>
        <Detail label="应用 ID" value={accessCredentials.app.id} />
        <Detail label="连接密钥" value={secret} />
        <div className="mt-4 flex gap-2">
          <Button onClick={() => void navigator.clipboard.writeText(secret)}>复制密钥</Button>
          <Button
            variant="secondary"
            onClick={async () => {
              const result = await window.desktop!.accountData.regenerateClientAppSecret({
                targetId,
                id: accessCredentials.app.id,
              })
              if (result.ok) setSecret(result.data.connectionSecret)
              else showToast({ title: result.error.message, status: "error" })
            }}
          >
            重置密钥
          </Button>
        </div>
      </Modal>
    )
  async function save() {
    setBusy(true)
    const input = { targetId, name, description, visibility, userIds }
    if (mode === "create") {
      const result = await window.desktop!.accountData.createClientApp(input)
      setBusy(false)
      if (!result.ok) return showToast({ title: result.error.message, status: "error" })
      setCreatedCredentials(result.data)
      setSecret(result.data.connectionSecret)
      showToast({ title: "应用已创建", status: "success" })
      onChanged()
      return
    }
    const result = await window.desktop!.accountData.updateClientApp({
      ...input,
      appId: credentials!.app.id,
    })
    setBusy(false)
    if (!result.ok) return showToast({ title: result.error.message, status: "error" })
    showToast({ title: "应用资料已更新", status: "success" })
    onChanged()
    onClose()
  }
  return (
    <Modal title={mode === "create" ? "创建应用" : "修改应用资料"} onClose={onClose}>
      <div className="grid gap-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="应用名称" />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="应用描述"
        />
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as ClientAppVisibility)}
        >
          <option value="creator">仅创建者</option>
          <option value="public">所有用户</option>
          <option value="restricted">指定用户</option>
        </select>
        {visibility === "restricted" && (
          <div className="max-h-36 overflow-y-auto rounded-md border p-2">
            {users.map((user) => (
              <label key={user.id} className="flex gap-2 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={userIds.includes(user.id)}
                  onChange={(e) =>
                    setUserIds((current) =>
                      e.target.checked
                        ? [...current, user.id]
                        : current.filter((id) => id !== user.id),
                    )
                  }
                />
                {user.name}
              </label>
            ))}
          </div>
        )}
        <Button disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? "保存中…" : "保存"}
        </Button>
        {mode === "edit" && credentials && (
          <Button
            variant="secondary"
            onClick={async () => {
              const selected = await window.desktop!.accountData.selectClientAppAvatar(targetId)
              if (!selected.ok || !selected.data) {
                if (!selected.ok) showToast({ title: selected.error.message, status: "error" })
                return
              }
              const uploaded = await window.desktop!.accountData.uploadClientAppAvatar({
                targetId,
                appId: credentials.app.id,
                selectionToken: selected.data.token,
              })
              if (!uploaded.ok) {
                showToast({ title: uploaded.error.message, status: "error" })
                return
              }
              showToast({ title: "应用头像已更新", status: "success" })
              onChanged()
            }}
          >
            更换头像
          </Button>
        )}
        {mode === "edit" && credentials && (
          <Button
            variant="destructive"
            onClick={async () => {
              if (
                prompt(`请输入应用名称“${credentials.app.name}”以确认删除`) !== credentials.app.name
              )
                return
              const result = await window.desktop!.accountData.deleteClientApp({
                targetId,
                id: credentials.app.id,
              })
              if (result.ok) {
                onDeleted()
                onClose()
              } else showToast({ title: result.error.message, status: "error" })
            }}
          >
            删除应用
          </Button>
        )}
      </div>
    </Modal>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 py-2">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  )
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-card p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}
