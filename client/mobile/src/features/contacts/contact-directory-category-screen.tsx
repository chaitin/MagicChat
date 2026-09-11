import { useLocalSearchParams, useRouter } from "expo-router"
import { useMemo } from "react"

import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { AppHeader } from "@/components/navigation/app-header"
import { ContactDirectoryList } from "@/features/contacts/contact-directory-list"
import {
  buildDirectoryCategorySections,
  DIRECTORY_CATEGORY_TITLES,
  type DirectoryItem,
  isDirectoryCategory,
} from "@/features/contacts/contact-directory-model"
import { buildEntityDetailHref } from "@/navigation/entity-details"
import { useAuthenticatedSession } from "@/providers/auth-provider"
import { useClientContacts } from "@/providers/client-data-provider"
import { useXGUITheme } from "@/xgui"

export function ContactDirectoryCategoryScreen() {
  const { colors } = useXGUITheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ category?: string | string[] }>()
  const session = useAuthenticatedSession()
  const {
    contacts,
    contactsError,
  } = useClientContacts()
  const categoryValue = Array.isArray(params.category)
    ? params.category[0]
    : params.category
  const category =
    categoryValue && isDirectoryCategory(categoryValue)
      ? categoryValue
      : null
  const sections = useMemo(
    () =>
      category
        ? buildDirectoryCategorySections({
            category,
            contacts,
            currentUserId: session.userId,
          })
        : [],
    [category, contacts, session.userId]
  )
  const title = category ? DIRECTORY_CATEGORY_TITLES[category] : "通讯录"
  const footerNoun =
    category === "new-friends"
      ? "朋友"
      : category === "my-apps" || category === "all-apps"
        ? "应用"
        : "群组"

  function handleItemPress(item: DirectoryItem) {
    router.push(
      buildEntityDetailHref({ id: item.value.id, type: item.type })
    )
  }

  return (
    <KeyboardAwareScreen
      contentBackground={colors.background0}
      edges={[]}
      scrollable={false}
    >
      <AppHeader onBackPress={() => router.back()} title={title} />
      <ContactDirectoryList
        emptyLabel={title}
        emptyMessageColor={
          category === "new-friends" ? colors.textSecondary : undefined
        }
        errorMessage={contactsError?.message}
        footerNoun={footerNoun}
        onItemPress={handleItemPress}
        sections={sections}
        server={session}
      />
    </KeyboardAwareScreen>
  )
}
