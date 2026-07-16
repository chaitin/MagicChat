import { useRouter } from "expo-router"
import { ArrowLeftRight } from "lucide-react-native"
import { SizableText } from "tamagui"

import { AppButton } from "@/components/forms/app-button"
import { ThemedIcon } from "@/components/icons/themed-icon"
import { useServers } from "@/features/servers/server-context"

const SERVER_SWITCH_ID = "login-server"

export function SelectedServerButton({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter()
  const { selectedServer } = useServers()

  return (
    <AppButton
      accessibilityLabel={`切换服务器，当前为${selectedServer.name}`}
      disabled={disabled}
      justify="space-between"
      noTextWrap
      onPress={() => router.push("/server-management")}
      size="$4"
      testID={SERVER_SWITCH_ID}
      theme="gray"
      width="100%"
    >
      <SizableText color="$gray12" grow={1} size="$4">
        {selectedServer.name}
      </SizableText>
      <ThemedIcon icon={ArrowLeftRight} />
    </AppButton>
  )
}
