export type ContactLinkTarget = { type: "user" | "app" | "group"; id: string };

const contactLinkPattern =
  /^jiying:\/\/(contact|app|group)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

export function parseContactLink(value: string): ContactLinkTarget | null {
  const match = contactLinkPattern.exec(value);
  if (!match || match[0] !== value) return null;
  return {
    type: match[1] === "contact" ? "user" : (match[1] as "app" | "group"),
    id: match[2].toLowerCase(),
  };
}

export function contactLink(target: ContactLinkTarget): string {
  const value = `jiying://${target.type === "user" ? "contact" : target.type}/${target.id}`;
  if (!parseContactLink(value)) throw new Error("名片链接格式不正确");
  return value;
}
