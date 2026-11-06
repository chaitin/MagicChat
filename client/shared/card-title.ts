export function cardDisplayTitle(title: string, url: string): string {
  const kind = /^jiying:\/\/(task|contact|app|group)\//.exec(url)?.[1];
  const label =
    kind === "task"
      ? "任务"
      : kind === "contact"
        ? "联系人"
        : kind === "app"
          ? "应用"
          : kind === "group"
            ? "群聊"
            : /^\/projects\/[^/?#]+(?:\?taskId=[^&#]+)?$/.test(url)
              ? url.includes("?taskId=")
                ? "任务"
                : "项目"
              : null;
  const prefix = label ? label + " - " : null;
  return prefix && title.startsWith(prefix)
    ? title.slice(prefix.length)
    : title;
}
