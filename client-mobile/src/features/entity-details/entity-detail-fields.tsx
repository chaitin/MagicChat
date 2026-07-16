import {
  Activity,
  Bot,
  Mail,
  Phone,
  UserPen,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react-native"
import { Fragment } from "react"
import { ListItem, Separator, YGroup } from "tamagui"

import { ThemedIcon } from "@/components/icons/themed-icon"
import { formatContactPhone } from "@/domain/contacts/contact-display"
import type { EntityProfile } from "@/domain/entities/entity-profile"

type ProfileField = {
  icon: LucideIcon
  label: string
  value: string
}

export function EntityDetailFields({ profile }: { profile: EntityProfile }) {
  const fields = buildProfileFields(profile)

  return (
    <YGroup
      borderColor="$borderColor"
      borderWidth={1}
      rounded="$4"
      size="$5"
    >
      {fields.map((field, index) => (
        <Fragment key={field.label}>
          <YGroup.Item>
            <ListItem
              icon={<ThemedIcon icon={field.icon} />}
              subTitle={field.value.trim() || "未设置"}
              title={field.label}
            />
          </YGroup.Item>
          {index < fields.length - 1 ? <Separator /> : null}
        </Fragment>
      ))}
    </YGroup>
  )
}

function buildProfileFields(profile: EntityProfile): ProfileField[] {
  if (profile.type === "user") {
    return [
      { icon: UserRound, label: "姓名", value: profile.name },
      { icon: UserPen, label: "昵称", value: profile.nickname },
      { icon: Mail, label: "邮箱", value: profile.email },
      {
        icon: Phone,
        label: "手机",
        value: formatContactPhone(profile.phone),
      },
    ]
  }

  if (profile.type === "app") {
    return [
      { icon: Bot, label: "类型", value: "应用" },
      {
        icon: Activity,
        label: "状态",
        value:
          profile.online === null ? "未知" : profile.online ? "在线" : "离线",
      },
    ]
  }

  return [
    { icon: UsersRound, label: "类型", value: "群聊" },
    {
      icon: UserRound,
      label: "成员",
      value: `${profile.memberCount} 人群聊`,
    },
    {
      icon: Activity,
      label: "状态",
      value: profile.joined ? "已加入" : "未加入",
    },
  ]
}
