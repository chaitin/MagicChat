import { useRouter } from "expo-router"
import { useMemo, useState } from "react"
import { SizableText, Tabs, YStack } from "tamagui"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { appConfig } from "@/config/app-config"
import { useCachedAppInfo } from "@/data/hooks"
import { useAuthenticatedSession } from "@/features/auth/auth-context"
import {
  buildDirectorySections,
  type DirectoryItem,
  type DirectoryTab,
} from "@/features/contacts/contact-directory-model"
import { ContactDirectoryList } from "@/features/contacts/contact-directory-list"
import { useClientData } from "@/providers/client-data-provider"
import { buildEntityDetailHref } from "@/navigation/entity-details"

const DIRECTORY_TABS: { label: string; value: DirectoryTab }[] = [
  { label: "联系人", value: "user" },
  { label: "应用", value: "app" },
  { label: "群组", value: "group" },
]

export function ContactsScreen() {
  const router = useRouter()
  const session = useAuthenticatedSession()
  const appInfoQuery = useCachedAppInfo(session)
  const {
    contacts,
    contactsError,
    isContactsRefreshing,
    refreshContacts,
  } = useClientData()
  const [activeTab, setActiveTab] = useState<DirectoryTab>("user")
  const organizationName =
    appInfoQuery.data?.organizationName ?? appConfig.organizationName
  const sections = useMemo(
    () =>
      buildDirectorySections({
        activeTab,
        contacts,
        currentUserId: session.userId,
        keyword: "",
        organizationName,
      }),
    [activeTab, contacts, organizationName, session.userId]
  )

  function handleTabChange(value: string) {
    if (value === "user" || value === "app" || value === "group") {
      setActiveTab(value)
    }
  }

  function handleRefresh() {
    void refreshContacts().catch(() => undefined)
  }

  function handleItemPress(item: DirectoryItem) {
    router.push(
      buildEntityDetailHref({ id: item.value.id, type: item.type })
    )
  }

  return (
    <KeyboardAwareScreen
      contentBackground="$color1"
      edges={[]}
      scrollable={false}
    >
      <YStack gap="$3" px="$4" py="$3">
        <Tabs onValueChange={handleTabChange} size="$3" value={activeTab}>
          <Tabs.List width="100%">
            {DIRECTORY_TABS.map((tab) => (
              <Tabs.Tab flex={1} key={tab.value} value={tab.value}>
                <SizableText size="$3">{tab.label}</SizableText>
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      </YStack>

      <ContactDirectoryList
        errorMessage={contactsError?.message}
        emptyLabel={getDirectoryTabLabel(activeTab)}
        isRefreshing={isContactsRefreshing}
        onRefresh={handleRefresh}
        onItemPress={handleItemPress}
        sections={sections}
        server={session}
      />
    </KeyboardAwareScreen>
  )
}

function getDirectoryTabLabel(tab: DirectoryTab) {
  if (tab === "app") {
    return "应用"
  }

  if (tab === "group") {
    return "群组"
  }

  return "联系人"
}
