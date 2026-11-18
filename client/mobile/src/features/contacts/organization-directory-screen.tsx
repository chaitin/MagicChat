import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Building2, ChevronRight, Folder } from "lucide-react-native";

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen";
import { AppHeader } from "@/components/navigation/app-header";
import { ListItemContent } from "@/components/lists/list-item-content";
import type { ContactUser } from "@/core/models";
import type { AuthenticatedTarget } from "@/core/server-target";
import {
  fetchDepartmentMembers,
  fetchOrganizationSnapshot,
  ORGANIZATION_FALLBACK_INTERVAL_MS,
  type MobileDepartmentMembers,
} from "@/data/contacts/organization-api";
import { getContactDisplayName } from "@/domain/contacts/contact-display";
import { ContactDirectoryAvatar } from "@/features/contacts/contact-directory-avatar";
import { OrganizationDirectoryBreadcrumbs } from "./organization-directory-breadcrumbs";
import { findOrganizationPath } from "./organization-directory-navigation";
import { buildEntityDetailHref } from "@/navigation/entity-details";
import { useAuthenticatedSession } from "@/providers/auth-provider";
import { useClientContacts } from "@/providers/client-data-provider";
import { XGUIFilledSearchBar, useXGUITheme } from "@/xgui";
import {
  buildOrganizationDirectoryTree,
  matchesOrganizationMember,
  OrganizationMemberPager,
  type OrganizationDirectoryNode,
} from "../../../../shared/organization-directory";

type Member = MobileDepartmentMembers["members"][number];

export function OrganizationDirectoryScreen() {
  const session = useAuthenticatedSession();
  return (
    <OrganizationDirectoryContent
      key={`${session.id}:${session.url}:${session.userId}`}
      session={session}
    />
  );
}

function OrganizationDirectoryContent({
  session,
}: {
  session: AuthenticatedTarget;
}) {
  const router = useRouter();
  const { colors } = useXGUITheme();
  const { contacts } = useClientContacts();
  const membershipKey = contacts.users
    .map((user) => user.id)
    .sort()
    .join(",");
  const [keyword, setKeyword] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const organization = useQuery({
    queryKey: ["organization", session.id, session.url, session.userId],
    queryFn: () => fetchOrganizationSnapshot(session),
    refetchInterval: ORGANIZATION_FALLBACK_INTERVAL_MS,
  });
  const refetch = organization.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  const tree = useMemo(
    () => organization.data ? buildOrganizationDirectoryTree(organization.data) : [],
    [organization.data],
  );
  const path = useMemo(() => {
    const selectedPath = findOrganizationPath(tree, selectedKey);
    return selectedPath.length ? selectedPath : tree.slice(0, 1);
  }, [tree, selectedKey]);
  const current = path.at(-1);
  const searching = Boolean(keyword.trim());
  const nodes = current?.children ?? tree;
  function navigateTo(key: string | null) {
    setSelectedKey(key);
    setKeyword("");
  }
  function handleBack() {
    if (searching) {
      setKeyword("");
    } else if (path.length > 1) {
      navigateTo(path.at(-2)!.key);
    } else {
      router.back();
    }
  }
  const matches = useMemo(
    () =>
      keyword.trim()
        ? contacts.users.filter((user) =>
            matchesOrganizationMember(user, keyword),
          )
        : [],
    [contacts.users, keyword],
  );
  const openProfile = (user: ContactUser) =>
    router.push(buildEntityDetailHref({ id: user.id, type: "user" }));
  const renderMember = (user: ContactUser, key = user.id) => (
    <MemberRow
      key={key}
      user={user}
      session={session}
      onPress={() => openProfile(user)}
    />
  );
  const renderNode = (node: OrganizationDirectoryNode) => {
    const Icon = node.kind === "unit" ? Building2 : Folder;
    return (
        <Pressable key={node.key}
          accessibilityRole="button"
          accessibilityLabel={node.name}
          onPress={() => navigateTo(node.key)}
          style={({ pressed }) => [
            styles.node,
            {
              backgroundColor:
                pressed ? colors.background1 : colors.background2,
              borderBottomColor: colors.separator,
            },
          ]}
        >
          <View style={[styles.nodeIcon, { backgroundColor: node.kind === "unit" ? colors.blue : colors.orange }]}>
            <Icon size={26} color={colors.textOnColor} strokeWidth={1.5} />
          </View>
          <Text numberOfLines={1} style={[styles.nodeName, { color: colors.textPrimary }]}>
            {node.name}
          </Text>
          {typeof node.memberCount === "number" ? (
            <Text style={{ fontSize: 12, color: colors.textSecondary, flexShrink: 0 }}>
              ({node.memberCount})
            </Text>
          ) : null}
          <ChevronRight
            size={18}
            color={colors.textSecondary}
          />
        </Pressable>
    );
  };
  return (
    <KeyboardAwareScreen
      contentBackground={colors.background0}
      edges={[]}
      scrollable={false}
    >
      <AppHeader onBackPress={handleBack} title="组织架构" />
      <XGUIFilledSearchBar
        accessibilityLabel="搜索成员"
        placeholder="搜索成员"
        value={keyword}
        onChangeText={setKeyword}
      />
      {!searching && <OrganizationDirectoryBreadcrumbs path={path} onNavigate={navigateTo} />}
      <OrganizationLevelContent
        key={searching ? `search:${keyword}` : current?.key ?? "root"}
        loading={!searching && organization.isPending}
        error={searching ? undefined : organization.error?.message}
        onRetry={() => void organization.refetch()}
        renderMember={renderMember}
        matches={matches}
        searching={searching}
        nodes={nodes}
        renderNode={renderNode}
        members={!searching && current?.departmentId ? (
          <NodeMembers
            key={`${current.departmentId}:${organization.dataUpdatedAt}:${membershipKey}`}
            departmentId={current.departmentId}
            hasChildNodes={nodes.length > 0}
            session={session}
            contacts={contacts.users}
            renderMember={renderMember}
          />
        ) : undefined}
      />
    </KeyboardAwareScreen>
  );
}

function OrganizationLevelContent({
  loading,
  error,
  onRetry,
  renderMember,
  matches,
  searching,
  nodes,
  renderNode,
  members,
}: {
  loading: boolean;
  error?: string;
  onRetry: () => void;
  renderMember: (user: ContactUser) => React.ReactNode;
  matches: ContactUser[];
  searching: boolean;
  nodes: OrganizationDirectoryNode[];
  members?: React.ReactNode;
  renderNode: (node: OrganizationDirectoryNode) => React.ReactNode;
}) {
  const { colors } = useXGUITheme();
  return (
    <KeyboardAwareScreen
      edges={[]}
      elastic
      contentBackground={colors.background0}
    >
      {loading && (
        <ActivityIndicator
          accessibilityLabel="正在加载组织架构"
          style={styles.status}
        />
      )}
      {Boolean(error) && (
        <View style={styles.status}>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {error}
          </Text>
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text style={{ color: colors.textPrimary, fontSize: 14 }}>
              重试
            </Text>
          </Pressable>
        </View>
      )}
      {searching && matches.length > 0 && (
        <View style={[styles.searchResults, { backgroundColor: colors.background2 }]}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            成员
          </Text>
          {matches.map((user) => renderMember(user))}
        </View>
      )}
      {!searching && (
        <View accessibilityLabel="组织架构" style={[styles.level, { backgroundColor: colors.background2 }]}>
          {nodes.map(renderNode)}
          {members}
        </View>
      )}
      {!loading && !error && (searching ? !matches.length : !nodes.length && !members) && (
        <Text
          style={[styles.status, { color: colors.textSecondary, fontSize: 14 }]}
        >
          {searching ? "没有匹配的成员" : "当前层级暂无内容"}
        </Text>
      )}
    </KeyboardAwareScreen>
  );
}

function NodeMembers({
  departmentId,
  hasChildNodes = false,
  session,
  contacts,
  renderMember,
}: {
  departmentId: string;
  hasChildNodes?: boolean;
  session: AuthenticatedTarget;
  contacts: ContactUser[];
  renderMember: (user: ContactUser) => React.ReactNode;
}) {
  const { colors } = useXGUITheme();
  const pager = useMemo(
    () =>
      new OrganizationMemberPager<Member>(async (page) => {
        const result = await fetchDepartmentMembers(
          session,
          departmentId,
          page,
        );
        if (!result) throw new Error("加载部门成员失败");
        return result;
      }),
    [departmentId, session],
  );
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot);
  useEffect(() => {
    void pager.loadNext();
  }, [pager]);
  return (
    <View accessibilityLabel="组织成员列表">
      {state.members.map((member) =>
        renderMember(
          contacts.find((user) => user.id === member.id) ?? {
            id: member.id,
            name: member.name,
            nickname: member.nickname,
            avatar: member.avatar,
            email: "",
            phone: "",
            online: false,
            lastOnlineAt: null,
            type: "user",
          },
        ),
      )}
      {state.loading && (
        <ActivityIndicator
          accessibilityLabel="加载成员"
          style={styles.status}
        />
      )}
      {Boolean(state.error) && (
        <View style={styles.status}>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
            {state.error}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={state.loading}
            onPress={() => void pager.loadNext()}
          >
            <Text style={{ color: colors.textPrimary, fontSize: 14 }}>
              重试
            </Text>
          </Pressable>
        </View>
      )}
      {!hasChildNodes &&
        !state.loading &&
        !state.error &&
        state.page > 0 &&
        !state.members.length && (
          <Text style={[styles.empty, { color: colors.textSecondary }]}>
            当前层级暂无内容
          </Text>
        )}
      {!state.error && state.members.length < state.total && (
        <Pressable
          accessibilityRole="button"
          disabled={state.loading}
          onPress={() => void pager.loadNext()}
          style={styles.more}
        >
          <Text style={{ color: colors.textPrimary, fontSize: 12 }}>
            {state.loading ? "加载中…" : "加载更多成员"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function MemberRow({
  user,
  session,
  onPress,
}: {
  user: ContactUser;
  session: AuthenticatedTarget;
  onPress: () => void;
}) {
  const { colors } = useXGUITheme();
  const name = getContactDisplayName(user);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`查看联系人 ${name}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.member,
        { backgroundColor: pressed ? colors.background1 : colors.background2, borderBottomColor: colors.separator },
      ]}
    >
      <ContactDirectoryAvatar
        avatar={user.avatar}
        name={name}
        online={user.online}
        server={session}
        size={44}
        type="user"
      />
      <View style={styles.memberContent}>
        <ListItemContent title={name} subtitle={user.email} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  level: { marginBottom: 16 },
  nodeIcon: {
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  node: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 64,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nodeName: { flex: 1, fontSize: 16 },
  memberContent: { flex: 1, minWidth: 0 },
  member: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 64,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  status: { padding: 16, gap: 8 },
  empty: { padding: 10, fontSize: 12 },
  more: { padding: 12 },
  searchResults: { marginBottom: 8 },
  sectionTitle: { fontSize: 12, paddingHorizontal: 16, paddingVertical: 8 },
});
