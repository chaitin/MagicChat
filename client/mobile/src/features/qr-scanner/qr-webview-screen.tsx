import { useLocalSearchParams, useRouter } from "expo-router"
import { Ellipsis, ExternalLink } from "lucide-react-native"
import { useMemo, useRef, useState } from "react"
import { Alert, Linking, StyleSheet, Text, View } from "react-native"
import { WebView, type WebViewNavigation } from "react-native-webview"

import { AppHeader } from "@/components/navigation/app-header"
import { classifyQrContent } from "@/features/qr-scanner/qr-content-classifier"
import { XGUILoadingIcon, XGUIPopoverMenu, useXGUITheme } from "@/xgui"

export function QrWebViewScreen() {
  const router = useRouter()
  const { url } = useLocalSearchParams<{ url?: string }>()
  const { colors } = useXGUITheme()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const menuAnchorRef = useRef<View>(null)
  const classification = useMemo(
    () => (typeof url === "string" ? classifyQrContent(url) : null),
    [url],
  )
  const safeUrl = classification?.kind === "web" ? classification.url : null
  const currentClassification = useMemo(
    () => (currentUrl ? classifyQrContent(currentUrl) : null),
    [currentUrl]
  )
  const browserUrl =
    currentClassification?.kind === "web"
      ? currentClassification.url
      : safeUrl

  function shouldStartLoad(request: WebViewNavigation) {
    return classifyQrContent(request.url).kind === "web"
  }

  async function openInBrowser() {
    if (!browserUrl) return
    try {
      await Linking.openURL(browserUrl)
    } catch {
      Alert.alert("无法打开", "当前网页暂时无法在浏览器中打开。")
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background0 }]}>
      <AppHeader
        actions={[
          {
            buttonRef: menuAnchorRef,
            icon: Ellipsis,
            iconColor: colors.textPrimary,
            label: "更多",
            onPress: () => setMenuOpen(true),
          },
        ]}
        onBackPress={() => router.back()}
        title="网页"
      />
      {safeUrl && !loadError ? (
        <View style={styles.webContainer}>
          <WebView
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            cacheEnabled={false}
            incognito
            mixedContentMode="never"
            onError={(event) => {
              setLoading(false)
              setLoadError(event.nativeEvent.description || "网页加载失败")
            }}
            onLoadEnd={() => setLoading(false)}
            onLoadStart={() => {
              setLoadError(null)
              setLoading(true)
            }}
            onNavigationStateChange={(navigation) => {
              if (classifyQrContent(navigation.url).kind === "web") {
                setCurrentUrl(navigation.url)
              }
            }}
            onShouldStartLoadWithRequest={shouldStartLoad}
            originWhitelist={["http://*", "https://*"]}
            sharedCookiesEnabled={false}
            source={{ uri: safeUrl }}
            thirdPartyCookiesEnabled={false}
          />
          {loading ? (
            <View pointerEvents="none" style={[styles.loading, { backgroundColor: colors.background0 }]}>
              <XGUILoadingIcon color={colors.textPlaceholder} size={40} />
            </View>
          ) : null}
        </View>
      ) : (
        <View style={styles.errorPanel}>
          <Text style={[styles.errorTitle, { color: colors.textPrimary }]}>无法打开网页</Text>
          <Text style={[styles.errorBody, { color: colors.textSecondary }]}>
            {loadError ?? "二维码中的链接无效或不受支持"}
          </Text>
        </View>
      )}
      <XGUIPopoverMenu
        anchorRef={menuAnchorRef}
        backgroundColor={colors.background0}
        foregroundColor={colors.textPrimary}
        items={[
          {
            disabled: !browserUrl,
            icon: (props) => <ExternalLink {...props} />,
            label: "在浏览器里打开",
            onPress: () => void openInBrowser(),
          },
        ]}
        onOpenChange={setMenuOpen}
        open={menuOpen}
        width={190}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  errorBody: { fontSize: 15, lineHeight: 22, marginTop: 8, textAlign: "center" },
  errorPanel: { alignItems: "center", flex: 1, justifyContent: "center", paddingHorizontal: 32 },
  errorTitle: { fontSize: 20, fontWeight: "600" },
  loading: { alignItems: "center", bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  screen: { flex: 1 },
  webContainer: { flex: 1 },
})
