import {
  type EventSubscription,
  requireOptionalNativeModule,
} from "expo-modules-core"

export type MessageSelectionAction = "copy" | "forward" | "reply" | "revoke"

export type MessageSelectionActionEvent = {
  action: MessageSelectionAction
  messageId: string
}

type MessageSelectionEvents = {
  onMessageAction: (event: MessageSelectionActionEvent) => void
}

type MessageSelectionNativeModule = {
  addListener: (
    eventName: "onMessageAction",
    listener: MessageSelectionEvents["onMessageAction"]
  ) => EventSubscription
}

const nativeModule = requireOptionalNativeModule<
  MessageSelectionNativeModule
>("MagicChatMessageSelection")

export function addMessageSelectionActionListener(
  listener: (event: MessageSelectionActionEvent) => void
): EventSubscription | null {
  return nativeModule?.addListener("onMessageAction", listener) ?? null
}
