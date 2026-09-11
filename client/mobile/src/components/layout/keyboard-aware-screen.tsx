import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
} from "react-native"
import {
  SafeAreaView,
  type Edge,
} from "react-native-safe-area-context"
import { YStack, type YStackProps } from "tamagui"

import { ElasticOverscroll } from "@/components/layout/elastic-overscroll"

type KeyboardAwareScreenProps = React.PropsWithChildren<
  YStackProps & {
    contentBackground?: YStackProps["bg"]
    edges?: readonly Edge[]
    elastic?: boolean
    keyboardShouldPersistTaps?: ScrollViewProps["keyboardShouldPersistTaps"]
    keyboardVerticalOffset?: number
    scrollable?: boolean
  }
>

export function KeyboardAwareScreen({
  children,
  contentBackground = "$background",
  edges,
  elastic = false,
  keyboardShouldPersistTaps = "handled",
  keyboardVerticalOffset = 0,
  scrollable = true,
  ...contentProps
}: KeyboardAwareScreenProps) {
  const content = (
    <YStack
      {...contentProps}
      bg={contentBackground}
      grow={1}
      minH={0}
      shrink={scrollable ? 0 : 1}
    >
      {children}
    </YStack>
  )

  return (
    <SafeAreaView edges={edges} style={styles.fill}>
      <KeyboardAvoidingView
        behavior={Platform.select({ android: "height", ios: "padding" })}
        keyboardVerticalOffset={keyboardVerticalOffset}
        style={styles.fill}
      >
        {scrollable && elastic ? (
          <ElasticOverscroll>
            {(elasticBindings) => (
              <ScrollView
                {...elasticBindings}
                alwaysBounceVertical
                bounces
                contentContainerStyle={styles.scrollContent}
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                keyboardShouldPersistTaps={keyboardShouldPersistTaps}
                overScrollMode={Platform.OS === "android" ? "never" : "always"}
              >
                {content}
              </ScrollView>
            )}
          </ElasticOverscroll>
        ) : scrollable ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardDismissMode={
              Platform.OS === "ios" ? "interactive" : "on-drag"
            }
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}
            overScrollMode="auto"
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
})
