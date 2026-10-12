import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native"
import {
  SafeAreaView,
  type Edge,
} from "react-native-safe-area-context"

import { ElasticOverscroll } from "@/components/layout/elastic-overscroll"
import { useXGUITheme } from "@/xgui"

type KeyboardAwareScreenProps = React.PropsWithChildren<{
  contentBackground?: string
  contentStyle?: StyleProp<ViewStyle>
  edges?: readonly Edge[]
  elastic?: boolean
  keyboardShouldPersistTaps?: ScrollViewProps["keyboardShouldPersistTaps"]
  keyboardVerticalOffset?: number
  scrollable?: boolean
}>

export function KeyboardAwareScreen({
  children,
  contentBackground,
  contentStyle,
  edges,
  elastic = false,
  keyboardShouldPersistTaps = "handled",
  keyboardVerticalOffset = 0,
  scrollable = true,
}: KeyboardAwareScreenProps) {
  const { colors } = useXGUITheme()
  const content = (
    <View style={[styles.content, { backgroundColor: contentBackground ?? colors.background0, flexShrink: scrollable ? 0 : 1 }, contentStyle]}>
      {children}
    </View>
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
  content: { flexGrow: 1, minHeight: 0 },
  scrollContent: {
    flexGrow: 1,
  },
})
