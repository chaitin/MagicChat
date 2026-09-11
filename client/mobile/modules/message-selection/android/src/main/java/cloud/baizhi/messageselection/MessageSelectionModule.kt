package cloud.baizhi.messageselection

import android.os.Bundle
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MessageSelectionModule : Module(), MessageSelectionEventListener {
  override fun definition() = ModuleDefinition {
    Name("MagicChatMessageSelection")

    Events("onMessageAction")

    OnCreate {
      MessageSelectionEvents.addListener(this@MessageSelectionModule)
    }

    OnDestroy {
      MessageSelectionEvents.removeListener(this@MessageSelectionModule)
    }
  }

  override fun onMessageSelectionAction(action: String, messageId: String) {
    sendEvent(
      "onMessageAction",
      Bundle().apply {
        putString("action", action)
        putString("messageId", messageId)
      }
    )
  }
}
