import { StyleSheet, View } from "react-native";
import { Text } from "@/components/mi-sans-text";
import { formatContactPhone } from "@/domain/contacts/contact-display";
import type { EntityProfile } from "@/domain/entities/entity-profile";
import { XGUIList, XGUIListItem, useXGUITheme } from "@/xgui";

export type ProfileField = {
  label: string;
  value: string;
  memberships?: { unit: string; department: string; departmentID: string }[];
};

export function EntityDetailFields({
  profile,
  organizationFields = [],
}: {
  profile: EntityProfile;
  organizationFields?: ProfileField[];
}) {
  const profileFields = buildProfileFields(profile);
  const fields = [
    ...profileFields,
    ...(profile.type === "user" ? organizationFields : []),
  ];

  return (
    <XGUIList>
      {fields.map((field, index) => field.memberships?.length ? (
        <OrganizationField key={`${field.label}-${index}`} field={field} separator={index > 0} />
      ) : (
        <XGUIListItem
          key={`${field.label}-${index}`}
          minHeight={60}
          separator={index > 0}
          title={field.label}
          titleFontSize={16}
          value={field.value.trim() || "未设置"}
          valueNumberOfLines={index < profileFields.length ? 1 : 0}
        />
      ))}
    </XGUIList>
  );
}

function OrganizationField({ field, separator }: { field: ProfileField; separator: boolean }) {
  const { colors } = useXGUITheme();
  return (
    <View style={styles.organizationRow}>
      {separator ? <View style={[styles.separator, { backgroundColor: colors.separator }]} /> : null}
      <Text style={[styles.organizationLabel, { color: colors.textPrimary }]}>{field.label}</Text>
      <View style={styles.memberships}>
        {field.memberships?.map((membership) => (
          <Text key={membership.departmentID} style={[styles.membership, { color: colors.textSecondary }]}>
            {[membership.unit, membership.department].filter(Boolean).join(" / ")}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  organizationRow: { flexDirection: "row", alignItems: "center", gap: 16, padding: 16, minHeight: 60 },
  organizationLabel: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 24 },
  memberships: { flexShrink: 1, minWidth: 0, maxWidth: "75%", gap: 10 },
  membership: { fontSize: 16, lineHeight: 24, textAlign: "right" },
  separator: { position: "absolute", top: 0, left: 16, right: 0, height: StyleSheet.hairlineWidth },
});

function buildProfileFields(profile: EntityProfile): ProfileField[] {
  if (profile.type === "user") {
    return [
      { label: "姓名", value: profile.name },
      { label: "昵称", value: profile.nickname },
      { label: "邮箱", value: profile.email },
      { label: "手机", value: formatContactPhone(profile.phone) },
    ];
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
    ];
  }

  return [
    { label: "类型", value: "群聊" },
    { label: "成员", value: `${profile.memberCount} 人群聊` },
    { label: "状态", value: profile.joined ? "已加入" : "未加入" },
  ];
}
