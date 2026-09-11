import { StyleSheet, Text, View } from "react-native"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIListCountFooterProps = {
  count: number
  noun: string
}

export function XGUIListCountFooter({
  count,
  noun,
}: XGUIListCountFooterProps) {
  const { colors } = useXGUITheme()

  return (
    <View style={[styles.footer, { backgroundColor: colors.background2 }]}>
      <Text style={[styles.text, { color: colors.textPlaceholder }]}>
        共 {count} 个{noun}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  footer: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 16,
  },
  text: {
    fontSize: 15,
    lineHeight: 20,
    textAlign: "center",
  },
})
