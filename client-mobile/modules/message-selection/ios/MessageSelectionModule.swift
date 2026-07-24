import ExpoModulesCore
import Foundation

private let messageSelectionNotification = Notification.Name(
  "MagicChatMessageSelectionAction"
)

public final class MessageSelectionModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("MagicChatMessageSelection")

    Events("onMessageAction")

    OnCreate {
      self.observer = NotificationCenter.default.addObserver(
        forName: messageSelectionNotification,
        object: nil,
        queue: .main
      ) { [weak self] notification in
        guard
          let action = notification.userInfo?["action"] as? String,
          let messageId = notification.userInfo?["messageId"] as? String
        else {
          return
        }

        self?.sendEvent("onMessageAction", [
          "action": action,
          "messageId": messageId,
        ])
      }
    }

    OnDestroy {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
        self.observer = nil
      }
    }
  }
}
