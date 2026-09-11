import { QueryClientProvider, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { FlatList, Keyboard, Pressable, StyleSheet, Text } from "react-native"

import { AppAvatar } from "@/components/avatar/app-avatar"
import type { ServerTarget } from "@/core/server-target"
import type { MentionCandidate } from "@/features/conversation/composer/mention-model"
import {
  HalfScreenSearchInput,
  HalfScreenSelectionRow,
} from "@/features/conversation/half-screen-selection-controls"
import { XGUIButton, XGUIHalfScreenDialog, useXGUITheme } from "@/xgui"

export function MentionPickerSheet({
  candidates,
  onAnimationComplete,
  onOpenChange,
  onSelect,
  onSelectMultiple,
  open,
  server,
}: {
  candidates: MentionCandidate[]
  onAnimationComplete: (open: boolean) => void
  onOpenChange: (open: boolean) => void
  onSelect: (candidate: MentionCandidate) => void
  onSelectMultiple: (candidates: MentionCandidate[]) => void
  open: boolean
  server: ServerTarget
}) {
  const queryClient = useQueryClient()
  const { colors } = useXGUITheme()
  const [keyword, setKeyword] = useState("")
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState(() => new Set<string>())
  const visibleCandidates = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLocaleLowerCase()
    if (!normalizedKeyword) return candidates
    return candidates.filter(
      (candidate) =>
        candidate.label.toLocaleLowerCase().includes(normalizedKeyword) ||
        candidate.description.toLocaleLowerCase().includes(normalizedKeyword)
    )
  }, [candidates, keyword])

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      Keyboard.dismiss()
      setKeyword("")
      setMultiSelect(false)
      setSelectedKeys(new Set())
    }
    onOpenChange(nextOpen)
  }

  function cancelMultiSelect() {
    setMultiSelect(false)
    setSelectedKeys(new Set())
  }

  function toggleCandidate(candidate: MentionCandidate) {
    const key = candidateKey(candidate)
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function submitMultiple() {
    if (selectedKeys.size === 0) return
    onSelectMultiple(
      candidates.filter((candidate) => selectedKeys.has(candidateKey(candidate)))
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <XGUIHalfScreenDialog
        closeButtonPosition="left"
        headerAction={
          multiSelect ? (
            <XGUIButton
              accessibilityLabel="完成选择"
              disabled={selectedKeys.size === 0}
              onPress={submitMultiple}
              size="mini"
              style={styles.completeButton}
              textStyle={styles.primaryButtonText}
            >
              {selectedKeys.size > 0 ? `完成(${selectedKeys.size})` : "完成"}
            </XGUIButton>
          ) : (
            <Pressable
              accessibilityLabel="进入多选模式"
              hitSlop={8}
              onPress={() => setMultiSelect(true)}
              style={({ pressed }) => [
                styles.headerButton,
                pressed ? styles.headerButtonPressed : null,
              ]}
            >
              <Text
                style={[
                  styles.headerButtonText,
                  { color: colors.textPrimary },
                ]}
              >
                多选
              </Text>
            </Pressable>
          )
        }
        headerLeading={
          multiSelect ? (
            <Pressable
              accessibilityLabel="退出多选模式"
              hitSlop={8}
              onPress={cancelMultiSelect}
              style={({ pressed }) => [
                styles.headerButton,
                pressed ? styles.headerButtonPressed : null,
              ]}
            >
              <Text
                style={[styles.headerButtonText, { color: colors.textPrimary }]}
              >
                取消
              </Text>
            </Pressable>
          ) : undefined
        }
        onAnimationComplete={onAnimationComplete}
        onOpenChange={handleOpenChange}
        open={open}
        title="选择提醒的人"
      >
        <HalfScreenSearchInput
          onChangeText={setKeyword}
          placeholder="搜索成员"
          value={keyword}
        />
        <FlatList
          contentContainerStyle={styles.content}
          data={visibleCandidates}
          initialNumToRender={12}
          keyboardShouldPersistTaps="always"
          keyExtractor={candidateKey}
          maxToRenderPerBatch={12}
          renderItem={({ item: candidate }) => {
            const selected = selectedKeys.has(candidateKey(candidate))
            return (
              <HalfScreenSelectionRow
              accessibilityLabel={`提醒 ${candidate.label}`}
              checkbox={multiSelect}
              leading={
                <AppAvatar
                  accessibilityLabel={candidate.label}
                  avatar={
                    candidate.targetType === "all" ? "" : candidate.avatar
                  }
                  server={server}
                  size="$3"
                  type={
                    candidate.targetType === "all" ? "group" : "user"
                  }
                />
              }
              onPress={() =>
                multiSelect ? toggleCandidate(candidate) : onSelect(candidate)
              }
              selected={selected}
              title={candidate.label}
              />
            )
          }}
          showsVerticalScrollIndicator={false}
        />
      </XGUIHalfScreenDialog>
    </QueryClientProvider>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 20,
  },
  completeButton: {
    height: 32,
    minWidth: 64,
  },
  headerButton: {
    justifyContent: "center",
    minHeight: 40,
    minWidth: 56,
    paddingHorizontal: 4,
  },
  headerButtonPressed: {
    opacity: 0.5,
  },
  headerButtonText: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: "center",
  },
  primaryButtonText: {
    fontSize: 15,
    lineHeight: 20,
  },
})

function candidateKey(candidate: MentionCandidate) {
  return `${candidate.targetType}:${candidate.id}`
}
