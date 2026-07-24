package cloud.baizhi.messageselection

import java.util.concurrent.CopyOnWriteArraySet

fun interface MessageSelectionEventListener {
  fun onMessageSelectionAction(action: String, messageId: String)
}

object MessageSelectionEvents {
  private val listeners = CopyOnWriteArraySet<MessageSelectionEventListener>()

  @JvmStatic
  fun addListener(listener: MessageSelectionEventListener) {
    listeners.add(listener)
  }

  @JvmStatic
  fun removeListener(listener: MessageSelectionEventListener) {
    listeners.remove(listener)
  }

  @JvmStatic
  fun emit(action: String, messageId: String) {
    listeners.forEach { listener ->
      listener.onMessageSelectionAction(action, messageId)
    }
  }
}
