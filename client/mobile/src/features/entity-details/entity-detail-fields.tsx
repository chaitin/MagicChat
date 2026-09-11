import { formatContactPhone } from "@/domain/contacts/contact-display"
import type { EntityProfile } from "@/domain/entities/entity-profile"
import { XGUIList, XGUIListItem } from "@/xgui"

type ProfileField = {
  label: string
  value: string
}

export function EntityDetailFields({ profile }: { profile: EntityProfile }) {
  const fields = buildProfileFields(profile)

  return (
    <XGUIList>
      {fields.map((field, index) => (
        <XGUIListItem
          key={field.label}
          minHeight={60}
          separator={index > 0}
          title={field.label}
          titleFontSize={18}
          value={field.value.trim() || "未设置"}
        />
      ))}
    </XGUIList>
  )
}

function buildProfileFields(profile: EntityProfile): ProfileField[] {
  if (profile.type === "user") {
    return [
      { label: "姓名", value: profile.name },
      { label: "昵称", value: profile.nickname },
      { label: "邮箱", value: profile.email },
      { label: "手机", value: formatContactPhone(profile.phone) },
    ]
  }

  if (profile.type === "app") {
    return [
      { label: "类型", value: "应用" },
      ...(profile.developerName
        ? [{ label: "开发者", value: profile.developerName }]
        : []),
      {
        label: "状态",
        value:
          profile.online === null ? "未知" : profile.online ? "在线" : "离线",
      },
    ]
  }

  return [
    { label: "类型", value: "群聊" },
    { label: "成员", value: `${profile.memberCount} 人群聊` },
    { label: "状态", value: profile.joined ? "已加入" : "未加入" },
  ]
}
