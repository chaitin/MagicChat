// Markdown 保存文件 ID，不保存会过期的签名下载地址。
export function markdownAttachmentFileId(source: unknown): string | null {
  if (typeof source !== "string") return null;
  return /^attachment:([A-Za-z0-9_-]{1,128})$/.exec(source)?.[1] ?? null;
}

export function markdownAttachmentSource(fileId: string): string {
  const source = `attachment:${fileId}`;
  if (!markdownAttachmentFileId(source)) throw new Error("图片文件标识不正确");
  return source;
}
