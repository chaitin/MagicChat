import StudentCardIcon from "@hugeicons/core-free-icons/dist/esm/StudentCardIcon"
import { useRouter } from "expo-router"
import Svg, { Path } from "react-native-svg"
import { buildSendTargetHref } from "@/navigation/send-target"
import { useAuth, useAuthenticatedSession } from "@/providers/auth-provider"
import { XGUIListItem, useXGUITheme } from "@/xgui"
import type { EntityReference } from "@/domain/entities/entity-profile"

export function SendNamecardAction({ target }: { target: EntityReference }) {
  const session = useAuthenticatedSession()
  const { generation } = useAuth()
  const router = useRouter()
  const { colors } = useXGUITheme()
  return (
    <XGUIListItem
      accessibilityLabel="推荐给好友"
      centerContent
      leading={
        <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" accessible={false}>
          {StudentCardIcon.map(([, attributes]) => (
            <Path
              key={attributes.key}
              d={attributes.d}
              stroke={colors.link}
              strokeWidth={1}
              strokeLinecap={attributes.strokeLinecap}
              strokeLinejoin={attributes.strokeLinejoin}
            />
          ))}
        </Svg>
      }
      link
      minHeight={60}
      onPress={() => router.push(buildSendTargetHref(session, generation, { purpose: "namecard", entity: target }))}
      title="推荐给好友"
      titleFontSize={16}
    />
  )
}
