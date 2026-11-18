import type { CellContext } from "@tanstack/react-table"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { getColumns, type Member } from "@/pages/members-page"

const member: Member = {
  id: "leader",
  name: "贾宁",
  nickname: "",
  avatar: "",
  jobTitle: "高级工程师",
  email: "leader@example.test",
  phone: "",
  joinedAt: "",
  lastOnlineAt: "",
  online: false,
  status: "enabled",
}

function renderIdentity(
  organizationLeaders?: { user_id: string; is_primary: boolean }[],
  value = member
) {
  const column = getColumns({
    organizationLeaders,
    updatingMemberId: null,
    onResetPassword: () => {},
    onStatusChange: () => {},
  }).find((column) => "accessorKey" in column && column.accessorKey === "name")
  const cell = column?.cell
  if (typeof cell !== "function") throw new Error("找不到姓名单元格")
  return renderToStaticMarkup(
    cell({ row: { original: value } } as CellContext<Member, unknown>)
  )
}

describe("成员姓名旁的当前组织负责人标识", () => {
  it("在姓名旁标识单位或单人部门负责人，不修改职务", () => {
    const html = renderIdentity([{ user_id: "leader", is_primary: true }])
    expect(html).toContain("贾宁")
    expect(html).toMatch(/data-slot="badge"[^>]*>负责人</)
    expect(html).not.toContain("主负责人")
    expect(member.jobTitle).toBe("高级工程师")
  })

  it("多负责人部门区分主负责人和其他负责人", () => {
    const leaders = [
      { user_id: "leader", is_primary: true },
      { user_id: "other", is_primary: false },
    ]
    expect(renderIdentity(leaders)).toMatch(/data-slot="badge"[^>]*>主负责人</)
    expect(renderIdentity(leaders, { ...member, id: "other" })).toMatch(
      /data-slot="badge"[^>]*>负责人</
    )
  })

  it("普通成员即使职务叫负责人也不显示负责人标识", () => {
    expect(
      renderIdentity([{ user_id: "other", is_primary: true }], {
        ...member,
        jobTitle: "技术负责人",
      })
    ).not.toContain('data-slot="badge"')
  })

  it("切换到其他组织或没有负责人上下文时不保留之前的标识", () => {
    expect(renderIdentity([{ user_id: "leader", is_primary: true }])).toContain(
      'data-slot="badge"'
    )
    for (const leaders of [
      undefined,
      [],
      [{ user_id: "other", is_primary: true }],
    ]) {
      expect(renderIdentity(leaders)).not.toContain('data-slot="badge"')
    }
  })
})
