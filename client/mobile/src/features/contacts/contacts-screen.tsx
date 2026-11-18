import { useRouter, type Href } from "expo-router"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import {
  ContactDirectoryHomeHeader,
  type ContactDirectoryHomeEntry,
} from "@/features/contacts/contact-directory-home-header"
import { ContactDirectoryList } from "@/features/contacts/contact-directory-list"
import {
  buildDirectorySections,
  type DirectoryCategory,
  type DirectoryItem,
} from "@/features/contacts/contact-directory-model"
import { buildEntityDetailHref } from "@/navigation/entity-details"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { useClientContacts } from "@/providers/client-data-provider"
import { useXGUITheme } from "@/xgui"
import { fetchOrganizationSnapshot, ORGANIZATION_FALLBACK_INTERVAL_MS } from "@/data/contacts/organization-api"

export function ContactsScreen() {
  const { colors } = useXGUITheme()
  const router = useRouter()
  const session = useAuthenticatedSession()
  const organization = useQuery({
    queryKey: ["organization", session.id, session.url, session.userId],
    queryFn: () => fetchOrganizationSnapshot(session),
    refetchInterval: ORGANIZATION_FALLBACK_INTERVAL_MS,
  })
  const {
    contacts,
    contactsError,
  } = useClientContacts()
  const sections = useMemo(
    () =>
      buildDirectorySections({
        activeTab: "user",
        contacts,
        currentUserId: session.userId,
        keyword: "",
      }),
    [contacts, session.userId]
  )
  const entries = useMemo<ContactDirectoryHomeEntry[]>(
    () => [
      ...(organization.data?.units.length ? [{
        category: "organization",
        memberCount: organization.data.units.find((unit) => !unit.parent_id)?.member_count,
        label: organization.data.units.find((unit) => !unit.parent_id)?.name ?? "组织架构",
      } as const] : []),
      {
        category: "new-friends",
        count: 0,
        label: "新朋友",
      },
      {
        category: "my-apps",
        count: contacts.apps.filter(
          (app) =>
            app.creatorUserId?.toLocaleLowerCase() ===
            session.userId.toLocaleLowerCase()
        ).length,
        label: "我的应用",
      },
      {
        category: "all-apps",
        count: contacts.apps.length,
        label: "所有应用",
      },
      {
        category: "joined-groups",
        count: contacts.groups.filter((group) => group.joined).length,
        label: "我加入的群组",
      },
      {
        category: "public-groups",
        count: contacts.groups.filter(
          (group) => group.visibility === "public"
        ).length,
        label: "公开群组",
      },
    ],
    [contacts.apps, contacts.groups, contacts.users.length, organization.data, session.userId]
  )

  function handleItemPress(item: DirectoryItem) {
    router.push(
      buildEntityDetailHref({ id: item.value.id, type: item.type })
    )
  }

  function handleEntryPress(category: DirectoryCategory) {
    if (category === "organization") {
      router.push("/(app)/contacts/organization" as Href)
      return
    }
    router.push({
      params: { category },
      pathname: "/(app)/contacts/[category]",
    } as unknown as Href)
  }

  return (
    <KeyboardAwareScreen
      contentBackground={colors.background0}
      edges={[]}
      scrollable={false}
    >
      <ContactDirectoryList
        emptyLabel="联系人"
        errorMessage={contactsError?.message}
        footerNoun="联系人"
        listHeader={
          <ContactDirectoryHomeHeader
            entries={entries}
            onEntryPress={handleEntryPress}
            onSearchPress={() => router.push("/search")}
          />
        }
        onItemPress={handleItemPress}
        sections={sections}
        server={session}
      />
    </KeyboardAwareScreen>
  )
}
