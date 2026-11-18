import type { Dispatch, SetStateAction } from "react"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { UpdateAdminUserInput } from "@/lib/admin-users"

export type MemberProfileDraft = Pick<
  UpdateAdminUserInput,
  "name" | "email" | "phone" | "nickname"
>

export function MemberProfileFields({
  member,
  draft,
  onChange,
}: {
  member: { id: string; status: "enabled" | "disabled" }
  draft: MemberProfileDraft
  onChange: Dispatch<SetStateAction<MemberProfileDraft>>
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">基本资料</h2>
        <span className="text-muted-foreground">
          {member.status === "enabled" ? "启用" : "禁用"}
        </span>
      </div>
      <fieldset className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`member-name-${member.id}`}>姓名</FieldLabel>
          <Input
            id={`member-name-${member.id}`}
            required
            maxLength={120}
            value={draft.name}
            onChange={(event) =>
              onChange((current) => ({ ...current, name: event.target.value }))
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`member-nickname-${member.id}`}>昵称</FieldLabel>
          <Input
            id={`member-nickname-${member.id}`}
            maxLength={120}
            value={draft.nickname}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                nickname: event.target.value,
              }))
            }
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor={`member-email-${member.id}`}>
            邮箱（登录账号）
          </FieldLabel>
          <Input
            id={`member-email-${member.id}`}
            type="email"
            required
            maxLength={320}
            aria-describedby={`member-email-hint-${member.id}`}
            value={draft.email}
            onChange={(event) =>
              onChange((current) => ({ ...current, email: event.target.value }))
            }
          />
          <p
            id={`member-email-hint-${member.id}`}
            className="text-xs text-muted-foreground"
          >
            修改后使用新邮箱登录。
          </p>
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor={`member-phone-${member.id}`}>手机号</FieldLabel>
          <Input
            id={`member-phone-${member.id}`}
            type="tel"
            maxLength={32}
            value={draft.phone}
            onChange={(event) =>
              onChange((current) => ({ ...current, phone: event.target.value }))
            }
          />
        </Field>
      </fieldset>
    </section>
  )
}
