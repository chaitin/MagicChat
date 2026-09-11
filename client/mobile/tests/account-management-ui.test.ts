import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { createAccountRecord } from "@/data/auth/account-store"
import {
  accountLoginHref,
  AccountActionSingleFlight,
  addAccountServerHref,
  buildAccountListItems,
  isAccountLoginMode,
  loginForSelectedServerHref,
  parseServerManagementMode,
  performAccountLogout,
  performAccountSwitch,
  resolveLoginTarget,
  shouldRedirectAuthenticatedLogin,
} from "@/features/accounts/account-management-model"

const account = (userId: string, lastUsedAt: string, status: "ready" | "reauth-required" = "ready") =>
  createAccountRecord({ serverId: "server", url: "https://chat.example.com", userId,
    avatar: `/avatars/${userId}.webp`, name: `Name ${userId}`, email: `${userId}@example.com`, lastUsedAt, status })

test("account list maps current/reauth state and sorts current then recent", () => {
  const current = account("current", "2026-01-01T00:00:00Z")
  const recent = account("recent", "2026-01-03T00:00:00Z")
  const reauth = account("reauth", "2026-01-04T00:00:00Z", "reauth-required")
  const items = buildAccountListItems([recent, current, reauth], current.id)
  assert.deepEqual(items.map((item) => [item.accountId, item.status]), [
    [current.id, "current"], [reauth.id, "reauth-required"], [recent.id, "ready"],
  ])
  assert.match(items[1]!.accessibilityLabel, /需要重新登录/)
  assert.equal(items[0]!.avatar, "/avatars/current.webp")
  assert.equal(items[0]!.email, "current@example.com")
  assert.equal(items[0]!.target.url, "https://chat.example.com")
  assert.equal(JSON.stringify(items).toLowerCase().includes("token"), false)
})

test("account action is single-flight and stable accountId owns the operation", async () => {
  const flight = new AccountActionSingleFlight()
  let release!: () => void
  const calls: string[] = []
  const first = flight.run("A", async () => { calls.push("A"); await new Promise<void>((resolve) => { release = resolve }); return "done" })
  const duplicate = await flight.run("B", async () => { calls.push("B"); return "wrong" })
  assert.equal(duplicate, undefined)
  assert.equal(flight.active, "A")
  release()
  assert.equal(await first, "done")
  assert.deepEqual(calls, ["A"])
  assert.equal(flight.active, null)
})

test("switch success navigates, current is idempotent, and failure keeps original route", async () => {
  const calls: string[] = []
  assert.equal(await performAccountSwitch({ accountId: "A", currentAccountId: "A",
    switchAccount: async () => { calls.push("unexpected") }, navigate: () => calls.push("navigate") }), false)
  assert.equal(await performAccountSwitch({ accountId: "B", currentAccountId: "A",
    switchAccount: async (id) => { calls.push(`switch:${id}`) }, navigate: () => calls.push("messages") }), true)
  await assert.rejects(performAccountSwitch({ accountId: "C", currentAccountId: "B",
    switchAccount: async () => { throw new Error("offline") }, navigate: () => calls.push("wrong-route") }), /offline/)
  assert.deepEqual(calls, ["switch:B", "messages"])
})

test("logout keeps stable accountId and network failure does not navigate", async () => {
  const calls: string[] = []
  await performAccountLogout({ accountId: "stable-A", signOutAccount: async (id) => { calls.push(id) }, navigate: () => calls.push("navigate") })
  await assert.rejects(performAccountLogout({ accountId: "stable-B", signOutAccount: async () => { throw new Error("network") }, navigate: () => calls.push("wrong") }), /network/)
  assert.deepEqual(calls, ["stable-A", "navigate"])
})

test("reauth route locks every operation to AccountStore record B instead of selected A", () => {
  const selectedA = { id: "server-A", url: "https://a.example.com" }
  const recordB = createAccountRecord({ serverId: "server-B", url: "https://b.example.com/path/", userId: "user-B",
    name: "B", email: "b@example.com", lastUsedAt: "2026-01-01T00:00:00Z", status: "reauth-required" })
  const resolved = resolveLoginTarget({ accounts: [recordB], accountId: recordB.id, mode: "reauth", selectedServer: selectedA })
  assert.deepEqual(resolved.target, { id: "server-B", url: "https://b.example.com/path" })
  const calls: string[] = []
  for (const operation of ["app-info", "login", "bootstrap", "commit"]) calls.push(`${operation}:${resolved.target.id}:${resolved.target.url}`)
  assert.deepEqual(calls, [
    "app-info:server-B:https://b.example.com/path",
    "login:server-B:https://b.example.com/path",
    "bootstrap:server-B:https://b.example.com/path",
    "commit:server-B:https://b.example.com/path",
  ])
})

test("cold-start reauth stays pending until Auth hydrate, then resolves B or becomes invalid", () => {
  const selectedA = { id: "server-A", url: "https://a.example.com" }
  const pending = resolveLoginTarget({ accounts: [], accountId: "account-B", authHydrated: false, mode: "reauth", selectedServer: selectedA })
  assert.equal(pending.pendingReauth, true)
  assert.equal(pending.invalidReauth, false)
  assert.deepEqual(pending.target, selectedA)

  const recordB = createAccountRecord({ serverId: "server-B", url: "https://b.example.com", userId: "B",
    name: "B", lastUsedAt: "2026-01-01T00:00:00Z", status: "reauth-required" })
  const hydrated = resolveLoginTarget({ accounts: [recordB], accountId: recordB.id, authHydrated: true, mode: "reauth", selectedServer: selectedA })
  assert.equal(hydrated.pendingReauth, false)
  assert.equal(hydrated.invalidReauth, false)
  assert.deepEqual(hydrated.target, { id: "server-B", url: "https://b.example.com" })

  const removed = resolveLoginTarget({ accounts: [], accountId: recordB.id, authHydrated: true, mode: "reauth", selectedServer: selectedA })
  assert.equal(removed.pendingReauth, false)
  assert.equal(removed.invalidReauth, true)
})

test("ordinary/add-account target resolution does not wait for Auth hydrate", () => {
  const selected = { id: "selected", url: "https://selected.example.com" }
  for (const mode of [undefined, "add-account"]) {
    const resolved = resolveLoginTarget({ accounts: [], accountId: undefined, authHydrated: false, mode, selectedServer: selected })
    assert.equal(resolved.pendingReauth, false)
    assert.equal(resolved.invalidReauth, false)
    assert.deepEqual(resolved.target, selected)
  }
})

test("reauth missing/invalid account is rejected and route-supplied server fields are ignored", () => {
  const selectedA = { id: "server-A", url: "https://a.example.com" }
  for (const accountId of [undefined, "forged-account"]) {
    const resolved = resolveLoginTarget({ accounts: [], accountId, mode: "reauth", selectedServer: selectedA })
    assert.equal(resolved.invalidReauth, true)
  }
  const recordB = account("B", "2026-01-01T00:00:00Z", "reauth-required")
  const resolved = resolveLoginTarget({ accounts: [recordB], accountId: recordB.id, mode: "reauth", selectedServer: selectedA })
  assert.equal(resolved.target.url, recordB.url)
  assert.notEqual(resolved.target.url, "https://forged.example.com")
})

test("missing ServerProvider configuration still rebuilds target solely from account record", () => {
  const selectedA = { id: "server-A", url: "https://a.example.com" }
  const recordB = createAccountRecord({ serverId: "deleted-server-B", url: "https://b.example.com", userId: "B",
    name: "B", lastUsedAt: "2026-01-01T00:00:00Z", status: "reauth-required" })
  const resolved = resolveLoginTarget({ accounts: [recordB], accountId: recordB.id, mode: "reauth", selectedServer: selectedA })
  assert.deepEqual(resolved.target, { id: "deleted-server-B", url: "https://b.example.com" })
})

test("add, cancel, reauth and authenticated route guards remain separate", () => {
  assert.equal(accountLoginHref("account a"), "/login?mode=reauth&returnTo=account-management&accountId=account%20a")
  assert.equal(addAccountServerHref(), "/server-management?mode=add-account&returnTo=account-management")
  assert.equal(loginForSelectedServerHref(), "/login?mode=add-account&returnTo=account-management")
  assert.equal(isAccountLoginMode("reauth"), true)
  assert.equal(shouldRedirectAuthenticatedLogin(true, "add-account"), false)
  assert.equal(shouldRedirectAuthenticatedLogin(true, undefined), true)
  assert.equal(parseServerManagementMode("manage"), "manage")
  assert.equal(parseServerManagementMode("add-account"), "add-account")
})

test("account UI has explicit accessibility labels and never serializes credentials", async () => {
  const source = await readFile(new URL("../src/features/accounts/account-management-screen.tsx", import.meta.url), "utf8")
  assert.match(source, /accessibilityLabel={`登出账号\$\{item\.email\}`}/)
  assert.match(source, /<YStack px="\$4">\s*<XGUIList variant="form-radio">/)
  assert.match(source, /avatar=\{avatar\}/)
  assert.match(source, /disabled=\{disabled \|\| item\.isCurrent\}/)
  assert.match(source, /\{item\.isCurrent \? "当前" : "切换"\}/)
  assert.match(source, /<XGUIListItem[\s\S]*?separator=\{index > 0\}/)
  assert.doesNotMatch(source, /borderTopWidth=\{index/)
  assert.equal(source.match(/size="xmini"/g)?.length, 2)
  assert.equal(source.match(/hitSlop=\{\{ bottom: 8, left: 4, right: 4, top: 8 \}\}/g)?.length, 2)
  assert.equal(source.match(/minHeight: 28, paddingHorizontal: 8/g)?.length, 2)
  assert.equal(source.match(/fontSize: 12, lineHeight: 16/g)?.length, 2)
  assert.match(source, /variant="danger"/)
  assert.match(source, />\s*登出\s*<\/XGUIButton>/)
  assert.match(source, /title=\{item\.email\}/)
  assert.match(source, /description=\{item\.target\.url\}/)
  assert.doesNotMatch(source, /\{item\.status === "current" \? "当前"/)
  assert.match(source, /refreshMissingAccountProfiles/)
  assert.match(source, /toast\.show\(\{ duration: 0, message: "正在登出账号", type: "loading" \}\)/)
  assert.match(source, /toast\.show\(\{ duration: 0, message: "正在切换账号", modal: true, type: "loading" \}\)/)
  assert.match(source, /presentation === "logout-toast" && !failed\) toast\.hide\(\)/)
  assert.match(source, /}, "switch-toast"\)\.catch/)
  assert.match(source, /setSwitchItemsSnapshot\(items\)/)
  assert.match(source, /const displayedItems = switchItemsSnapshot \?\? items/)
  assert.match(source, /active\?\.accountId !== completedSwitchAccountId \|\| phase !== "authenticated"/)
  assert.match(source, /requestAnimationFrame\(\(\) => router\.dismissTo\("\/messages"\)\)/)
  assert.doesNotMatch(source, /navigate: \(\) => router\.replace\("\/messages"\)/)
  assert.match(source, /const globallyBusy = phase === "preparing"/)
  assert.doesNotMatch(source, /phase === "switching" \|\| phase === "preparing"|正在切换账号…|accessibilityRole="progressbar"/)
  assert.doesNotMatch(source, /phase === "signing-out" \? "正在登出账号/)
  assert.match(source, /setLogoutAvatarSnapshot\(\{ accountId: active\.accountId, avatar: currentUser\.avatar \}\)/)
  assert.match(source, /logoutAvatarSnapshot\?\.accountId === item\.accountId/)
  assert.match(source, /accessibilityLabel="添加账号"[\s\S]*?variant="secondary"/)
  assert.doesNotMatch(source, /accessibilityLabel="管理服务器"|>\s*服务器管理\s*</)
  assert.doesNotMatch(source, /token|authorization|localOnly/i)
})

test("切换阶段保持 active 账号的认证与已登录路由", async () => {
  const [layoutSource, authSource] = await Promise.all([
    readFile(new URL("../src/app/(app)/_layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/providers/auth-provider.tsx", import.meta.url), "utf8"),
  ])
  assert.match(authSource, /isAuthenticated: Boolean\(active\)/)
  assert.match(authSource, /await signOutAccount\(id\)[\s\S]*?return stateRef\.current\.active\?\.accountId \?\? null/)
  assert.doesNotMatch(authSource, /isAuthenticated: Boolean\(active\) &&/)
  assert.match(layoutSource, /if \(!isAuthenticated\) \{\s*return <Redirect href="\/server-management" \/>/)
})

test("设置页账号入口和退出登录保持静态 Toast 交互", async () => {
  const source = await readFile(new URL("../src/features/me/me-screen.tsx", import.meta.url), "utf8")
  assert.match(source, /<XGUIListItem\s*centerContent\s*destructive[\s\S]*?\/account-management[\s\S]*?title="切换账号"/)
  assert.match(source, /toast\.show\(\{ duration: 0, message: "正在退出登录", modal: true, type: "loading" \}\)/)
  assert.match(source, /const nextAccountId = await signOut\(\)[\s\S]*?setCompletedLogoutAccountId\(nextAccountId\)[\s\S]*?else toast\.hide\(\)/)
  assert.match(source, /active\?\.accountId !== completedLogoutAccountId \|\| phase !== "authenticated"[\s\S]*?router\.dismissTo\("\/messages"\)/)
  assert.doesNotMatch(source, /await signOut\(\)[\s\S]{0,200}?\/account-management/)
  assert.match(source, /deferUntilClosed: true,[\s\S]*?label: "退出登录"[\s\S]*?handleLogout/)
  assert.match(source, /onPress=\{confirmLogout\}[\s\S]*?title="退出登录"/)
  assert.doesNotMatch(source, /title=\{isSigningOut \? "正在退出…"|disabled=\{isSigningOut\}/)
  assert.doesNotMatch(source, /title="账号管理"|title="服务器管理"|\/server-management\?mode=manage/)
})
