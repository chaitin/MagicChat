import { useRouter } from "expo-router"
import { Search } from "lucide-react-native"
import { useMemo, useState } from "react"
import { Keyboard, StyleSheet } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { type ColorTokens, useTheme, XStack, YStack } from "tamagui"

import { ContentState } from "@/components/feedback/content-state"
import { AppInput } from "@/components/forms/app-input"
import { KeyboardAwareScreen } from "@/components/layout/keyboard-aware-screen"
import { HeaderButton } from "@/components/navigation/header-button"
import { PAGE_HEADER_HEIGHT } from "@/components/navigation/page-header"
import { useAuthenticatedSession } from "@/features/auth/auth-context"
import { SearchResultList } from "@/features/search/search-result-list"
import {
  buildGlobalSearchResults,
  type GlobalSearchResult,
} from "@/features/search/search-model"
import { buildConversationHref } from "@/navigation/conversations"
import { buildEntityDetailHref } from "@/navigation/entity-details"
import { useClientData } from "@/providers/client-data-provider"

export function SearchScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const session = useAuthenticatedSession()
  const theme = useTheme()
  const accentColor = theme.color10.val as ColorTokens
  const {
    contacts,
    conversations,
    currentUser,
    personalProject,
    projects,
  } = useClientData()
  const [keyword, setKeyword] = useState("")
  const hasKeyword = keyword.trim().length > 0
  const results = useMemo(
    () =>
      buildGlobalSearchResults({
        contacts,
        conversations,
        currentUserId: currentUser?.id ?? null,
        keyword,
        personalProject,
        projects,
      }),
    [
      contacts,
      conversations,
      currentUser?.id,
      keyword,
      personalProject,
      projects,
    ]
  )

  function handleCancel() {
    Keyboard.dismiss()
    router.back()
  }

  function handleResultPress(result: GlobalSearchResult) {
    if (result.type === "project") return

    Keyboard.dismiss()
    if (result.type === "conversation") {
      router.push(buildConversationHref(result.conversation.id))
      return
    }

    router.push(
      buildEntityDetailHref({
        id: result.contact.id,
        type: result.contact.type,
      })
    )
  }

  return (
    <KeyboardAwareScreen edges={[]} scrollable={false}>
      <YStack bg="$background" pt={insets.top}>
        <XStack
          gap="$2"
          height={PAGE_HEADER_HEIGHT}
          items="center"
          pl="$3"
          pr="$2"
        >
          <XStack
            bg="$background"
            borderColor="$gray7"
            borderWidth={1}
            flex={1}
            gap="$1.5"
            height="$2.5"
            items="center"
            px="$2"
            rounded="$3"
          >
            <Search color={String(theme.gray9.val)} size={16} />
            <AppInput
              accessibilityLabel="搜索"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocusNative
              bg="transparent"
              borderWidth={0}
              clearButtonMode="while-editing"
              color="$gray12"
              cursorColor={accentColor}
              flex={1}
              fontFamily="$body"
              fontSize="$4"
              focusStyle={{
                borderWidth: 0,
                outlineWidth: 0,
              }}
              height="100%"
              onChangeText={setKeyword}
              p={0}
              placeholder="搜索"
              placeholderTextColor="$gray9"
              returnKeyType="search"
              selectionColor={accentColor}
              style={styles.searchInput}
              textAlignVertical="center"
              unstyled
              value={keyword}
            />
          </XStack>
          <HeaderButton
            accessibilityLabel="取消搜索"
            onPress={handleCancel}
            size="$2.5"
          >
            取消
          </HeaderButton>
        </XStack>
      </YStack>

      <YStack bg="$color1" flex={1} minH={0} pb={insets.bottom}>
        {hasKeyword ? (
          <SearchResultList
            currentUser={currentUser}
            onResultPress={handleResultPress}
            results={results}
            server={session}
          />
        ) : (
          <ContentState message="输入关键词开始搜索" />
        )}
      </YStack>
    </KeyboardAwareScreen>
  )
}

const styles = StyleSheet.create({
  searchInput: {
    includeFontPadding: false,
    paddingVertical: 0,
  },
})
