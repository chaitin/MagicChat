export type TaskLinkTarget = { projectId: string; taskId: string };

const id =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const protocolPattern = new RegExp(`^jiying://task/(${id})/(${id})$`);
const legacyPattern = new RegExp(`^/projects/(${id})\\?taskId=(${id})$`);

export function parseTaskLink(value: string): TaskLinkTarget | null {
  const match = protocolPattern.exec(value) ?? legacyPattern.exec(value);
  if (!match || match[0] !== value) return null;
  return { projectId: match[1].toLowerCase(), taskId: match[2].toLowerCase() };
}

export function taskLink(target: TaskLinkTarget): string {
  const value = `jiying://task/${target.projectId}/${target.taskId}`;
  if (!parseTaskLink(value)) throw new Error("任务链接格式不正确");
  return value;
}
