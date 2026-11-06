export function cardSummary(description: string, kind: "task" | "user" | "app" | "group") {
  const fields = new Map(
    description.split("\n").flatMap((line) => {
      const match = /^(姓名|昵称|邮箱|手机号|手机|电话|状态|优先级)[:：]\s*(.*)$/.exec(line.trim())
      return match ? [[match[1], match[2].trim()] as const] : []
    }),
  )
  return {
    status: fields.get("状态") || "",
    priority: fields.get("优先级") || "",
    summary:
      kind === "user"
        ? fields.get("邮箱") ||
          fields.get("手机号") ||
          fields.get("手机") ||
          fields.get("电话") ||
          fields.get("昵称") ||
          fields.get("姓名") ||
          description
        : kind === "app" && !description.trim()
          ? "暂无说明"
          : description,
  }
}
