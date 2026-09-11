import { Linking, Pressable, StyleSheet, Text, View } from "react-native"

import { useXGUITheme } from "@/xgui/theme/use-xgui-theme"

export type XGUIFooterLink = {
  label: string
  url: string
}

export type XGUIFooterProps = {
  links?: readonly XGUIFooterLink[]
  text: string
}

export function XGUIFooter({ links = [], text }: XGUIFooterProps) {
  const { colors } = useXGUITheme()

  return (
    <View style={styles.footer}>
      {links.length > 0 ? (
        <View style={styles.links}>
          {links.map((link, index) => (
            <View key={`${link.label}-${link.url}`} style={styles.linkItem}>
              {index > 0 ? (
                <View
                  pointerEvents="none"
                  style={[styles.separator, { backgroundColor: colors.separator }]}
                />
              ) : null}
              <Pressable
                accessibilityLabel={`打开${link.label}`}
                accessibilityRole="link"
                hitSlop={8}
                onPress={() => void Linking.openURL(link.url)}
              >
                {({ pressed }) => (
                  <Text
                    style={[
                      styles.link,
                      { color: colors.link, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    {link.label}
                  </Text>
                )}
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={[styles.text, { color: colors.footerText }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  footer: {
    alignItems: "center",
  },
  link: {
    fontSize: 14,
    lineHeight: 20,
    marginHorizontal: 8,
  },
  linkItem: {
    alignItems: "center",
    flexDirection: "row",
  },
  links: {
    flexDirection: "row",
    justifyContent: "center",
  },
  separator: {
    height: 10,
    width: StyleSheet.hairlineWidth,
  },
  text: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 16,
    textAlign: "center",
  },
})
