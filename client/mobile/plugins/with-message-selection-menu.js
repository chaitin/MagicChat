const fs = require("node:fs")
const path = require("node:path")
const {
  IOSConfig,
  withDangerousMod,
  withMainActivity,
  withStringsXml,
  withXcodeProject,
} = require("expo/config-plugins")

const ACTIVITY_MARKER = "MessageTextSelectionActionModeCallback"
const IOS_SOURCE_FILE_NAME = "MagicChatMessageSelectionMenu.mm"

const androidImports = `import android.graphics.Rect
import android.text.Selection
import android.text.Spannable
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import cloud.baizhi.messageselection.MessageSelectionEvents`

const activityMembers = `
  private val configuredMessageTextViews = WeakHashMap<TextView, Unit>()
  private var activeMessageSelectionActionMode: ActionMode? = null
  private var activeMessageSelectionTextView: TextView? = null

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      dismissMessageTextSelectionOutside(event)
      installMessageSelectionCallbacks(window.decorView)
    }
    return super.dispatchTouchEvent(event)
  }

  /**
   * Keeps Android's native selection handles while replacing the floating toolbar used by
   * selectable message text. Text inputs retain their platform menus.
   */
  private inner class MessageTextSelectionActionModeCallback(
    private val textView: TextView
  ) : ActionMode.Callback2() {
    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
      val context = findMessageSelectionContext(textView) ?: return false
      activeMessageSelectionActionMode?.takeIf { it !== mode }?.finish()
      activeMessageSelectionActionMode = mode
      activeMessageSelectionTextView = textView
      configureMessageSelectionMenu(menu, context.canRevoke)
      return true
    }

    override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
      return false
    }

    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
      if (item.itemId == android.R.id.copy) {
        val handled = textView.onTextContextMenuItem(item.itemId)
        mode.finish()
        return handled
      }

      val context = findMessageSelectionContext(textView) ?: return false
      val action = when (item.itemId) {
        MESSAGE_ACTION_REPLY -> "reply"
        MESSAGE_ACTION_FORWARD -> "forward"
        MESSAGE_ACTION_REVOKE -> "revoke"
        else -> return false
      }
      if (action == "revoke" && !context.canRevoke) return false

      MessageSelectionEvents.emit(action, context.messageId)
      mode.finish()
      return true
    }

    override fun onDestroyActionMode(mode: ActionMode) {
      clearMessageTextSelection(textView)
      if (activeMessageSelectionActionMode === mode) {
        activeMessageSelectionActionMode = null
        activeMessageSelectionTextView = null
      }
    }
  }

  private fun dismissMessageTextSelectionOutside(event: MotionEvent) {
    val textView = activeMessageSelectionTextView ?: return
    val bounds = Rect()
    val touchedSelection =
      textView.getGlobalVisibleRect(bounds) &&
        bounds.contains(event.rawX.toInt(), event.rawY.toInt())
    if (!touchedSelection) {
      activeMessageSelectionActionMode?.finish()
    }
  }

  private fun clearMessageTextSelection(textView: TextView) {
    (textView.text as? Spannable)?.let { Selection.removeSelection(it) }
    textView.clearFocus()
  }

  private fun configureMessageSelectionMenu(menu: Menu, canRevoke: Boolean) {
    menu.clear()
    addMessageSelectionMenuItem(menu, android.R.id.copy, 0, R.string.message_action_copy)
    addMessageSelectionMenuItem(menu, MESSAGE_ACTION_REPLY, 1, R.string.message_action_reply)
    addMessageSelectionMenuItem(menu, MESSAGE_ACTION_FORWARD, 2, R.string.message_action_forward)
    if (canRevoke) {
      addMessageSelectionMenuItem(menu, MESSAGE_ACTION_REVOKE, 3, R.string.message_action_revoke)
    }
  }

  private fun addMessageSelectionMenuItem(
    menu: Menu,
    itemId: Int,
    order: Int,
    titleRes: Int
  ) {
    menu.add(Menu.NONE, itemId, order, titleRes)
      .setShowAsAction(MenuItem.SHOW_AS_ACTION_IF_ROOM)
  }

  private fun installMessageSelectionCallbacks(view: View) {
    if (
      view is TextView &&
      view !is EditText &&
      view.isTextSelectable &&
      findMessageSelectionContext(view) != null &&
      !configuredMessageTextViews.containsKey(view)
    ) {
      view.customSelectionActionModeCallback =
        MessageTextSelectionActionModeCallback(view)
      configuredMessageTextViews[view] = Unit
    }

    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        installMessageSelectionCallbacks(view.getChildAt(index))
      }
    }
  }

  private fun findMessageSelectionContext(view: View): MessageSelectionContext? {
    var current: View? = view
    while (current != null) {
      val nativeId = current.getTag(
        com.facebook.react.R.id.view_tag_native_id
      ) as? String
      parseMessageSelectionContext(nativeId)?.let { return it }
      current = current.parent as? View
    }
    return null
  }

  private fun parseMessageSelectionContext(
    nativeId: String?
  ): MessageSelectionContext? {
    if (nativeId == null || !nativeId.startsWith(MESSAGE_NATIVE_ID_PREFIX)) {
      return null
    }
    val value = nativeId.removePrefix(MESSAGE_NATIVE_ID_PREFIX)
    val parts = value.split(':', limit = 3)
    if (parts.size != 3 || parts[2].isEmpty()) return null

    val canRevoke = when (parts[0]) {
      "1" -> true
      "0" -> false
      else -> return null
    }
    if (parts[1] != "0" && parts[1] != "1") return null
    return MessageSelectionContext(canRevoke, parts[2])
  }

  private data class MessageSelectionContext(
    val canRevoke: Boolean,
    val messageId: String
  )

  private companion object {
    const val MESSAGE_ACTION_REPLY = 0x4D430001
    const val MESSAGE_ACTION_FORWARD = 0x4D430002
    const val MESSAGE_ACTION_REVOKE = 0x4D430003
    const val MESSAGE_NATIVE_ID_PREFIX = "magicchat-message:"
  }
`

const messageActionStrings = {
  message_action_copy: "复制",
  message_action_forward: "转发",
  message_action_reply: "回复",
  message_action_revoke: "撤回",
}

const iosSource = `#import <UIKit/UIKit.h>
#import <React/RCTParagraphComponentView.h>
#import <React/RCTViewComponentView.h>

#ifndef RCT_REMOVE_LEGACY_ARCH
#import <React/RCTTextView.h>
#endif

static NSString *const MagicChatMessageNativeIDPrefix = @"magicchat-message:";
static NSString *const MagicChatMessageSelectionNotification = @"MagicChatMessageSelectionAction";

static NSDictionary<NSString *, id> *MagicChatMessageContextForView(UIView *view)
{
  for (UIView *candidate = view; candidate != nil; candidate = candidate.superview) {
    NSString *nativeId = nil;
    if ([candidate isKindOfClass:[RCTViewComponentView class]]) {
      nativeId = ((RCTViewComponentView *)candidate).nativeId;
    } else if ([candidate respondsToSelector:@selector(nativeId)]) {
      nativeId = [candidate valueForKey:@"nativeId"];
    }

    if (![nativeId hasPrefix:MagicChatMessageNativeIDPrefix]) {
      continue;
    }

    NSString *value = [nativeId substringFromIndex:MagicChatMessageNativeIDPrefix.length];
    NSRange firstSeparator = [value rangeOfString:@":"];
    if (firstSeparator.location == NSNotFound || firstSeparator.location == 0) {
      return nil;
    }
    NSRange remainder = NSMakeRange(
        NSMaxRange(firstSeparator), value.length - NSMaxRange(firstSeparator));
    NSRange secondSeparator = [value rangeOfString:@":" options:0 range:remainder];
    if (secondSeparator.location == NSNotFound ||
        secondSeparator.location == NSMaxRange(firstSeparator) ||
        NSMaxRange(secondSeparator) >= value.length) {
      return nil;
    }

    NSString *revokeFlag = [value substringToIndex:firstSeparator.location];
    NSString *topicFlag = [value substringWithRange:NSMakeRange(
        NSMaxRange(firstSeparator),
        secondSeparator.location - NSMaxRange(firstSeparator))];
    if ((![revokeFlag isEqualToString:@"0"] && ![revokeFlag isEqualToString:@"1"]) ||
        (![topicFlag isEqualToString:@"0"] && ![topicFlag isEqualToString:@"1"])) {
      return nil;
    }

    return @{
      @"canRevoke": @([revokeFlag isEqualToString:@"1"]),
      @"messageId": [value substringFromIndex:NSMaxRange(secondSeparator)],
    };
  }
  return nil;
}

static void MagicChatEmitMessageAction(NSString *action, NSString *messageId)
{
  [[NSNotificationCenter defaultCenter]
      postNotificationName:MagicChatMessageSelectionNotification
                    object:nil
                  userInfo:@{ @"action": action, @"messageId": messageId }];
}

static UIAction *MagicChatCreateMessageAction(
    NSString *title,
    NSString *action,
    NSString *messageId) API_AVAILABLE(ios(16.0))
{
  return [UIAction actionWithTitle:title
                             image:nil
                        identifier:nil
                           handler:^(__unused UIAction *selectedAction) {
    MagicChatEmitMessageAction(action, messageId);
  }];
}

static UIMenu *MagicChatCreateMessageSelectionMenu(
    UIView *view,
    NSArray<UIMenuElement *> *suggestedActions) API_AVAILABLE(ios(16.0))
{
  NSDictionary<NSString *, id> *context = MagicChatMessageContextForView(view);
  if (context == nil) {
    return [UIMenu menuWithTitle:@"" children:suggestedActions];
  }

  NSString *messageId = context[@"messageId"];
  NSMutableArray<UIMenuElement *> *children = [NSMutableArray arrayWithArray:@[
    MagicChatCreateMessageAction(@"复制", @"copy", messageId),
    MagicChatCreateMessageAction(@"回复", @"reply", messageId),
    MagicChatCreateMessageAction(@"转发", @"forward", messageId),
  ]];
  if ([context[@"canRevoke"] boolValue]) {
    [children addObject:MagicChatCreateMessageAction(@"撤回", @"revoke", messageId)];
  }

  return [UIMenu menuWithTitle:@"" children:children];
}

@interface RCTParagraphComponentView (MagicChatMessageSelectionMenu)
@end

@implementation RCTParagraphComponentView (MagicChatMessageSelectionMenu)

- (UIMenu *)editMenuInteraction:(UIEditMenuInteraction *)interaction
           menuForConfiguration:(UIEditMenuConfiguration *)configuration
                suggestedActions:(NSArray<UIMenuElement *> *)suggestedActions API_AVAILABLE(ios(16.0))
{
  return MagicChatCreateMessageSelectionMenu(self, suggestedActions);
}

@end

#ifndef RCT_REMOVE_LEGACY_ARCH
@interface RCTTextView (MagicChatMessageSelectionMenu)
@end

@implementation RCTTextView (MagicChatMessageSelectionMenu)

- (UIMenu *)editMenuInteraction:(UIEditMenuInteraction *)interaction
           menuForConfiguration:(UIEditMenuConfiguration *)configuration
                suggestedActions:(NSArray<UIMenuElement *> *)suggestedActions API_AVAILABLE(ios(16.0))
{
  return MagicChatCreateMessageSelectionMenu(self, suggestedActions);
}

@end
#endif
`

function addMessageSelectionActivityCode(source) {
  if (source.includes(ACTIVITY_MARKER)) return source

  const bundleImport = "import android.os.Bundle"
  const activityDeclaration = "class MainActivity : ReactActivity() {"
  const finalBrace = source.lastIndexOf("\n}")

  if (!source.includes(bundleImport)) {
    throw new Error("Unable to add message selection imports to MainActivity.kt")
  }
  if (!source.includes(activityDeclaration) || finalBrace === -1) {
    throw new Error("Unable to add message selection behavior to MainActivity.kt")
  }

  let result = source.replace(
    bundleImport,
    `${bundleImport}\n${androidImports}`
  )
  result = result.replace(
    "import expo.modules.ReactActivityDelegateWrapper",
    "import expo.modules.ReactActivityDelegateWrapper\nimport java.util.WeakHashMap"
  )

  const insertionIndex = result.lastIndexOf("\n}")
  return `${result.slice(0, insertionIndex)}${activityMembers}${result.slice(insertionIndex)}`
}

function addMessageSelectionStrings(resources) {
  const strings = resources.string ?? []
  const existingNames = new Set(strings.map((entry) => entry.$?.name))

  for (const [name, value] of Object.entries(messageActionStrings)) {
    if (!existingNames.has(name)) {
      strings.push({ $: { name }, _: value })
    }
  }

  resources.string = strings
  return resources
}

function withIosMessageSelectionMenu(config) {
  config = withXcodeProject(config, (xcodeConfig) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(
      xcodeConfig.modRequest.projectRoot
    )
    const relativeFilePath = path.join(projectName, IOS_SOURCE_FILE_NAME)

    if (!xcodeConfig.modResults.hasFile(relativeFilePath)) {
      xcodeConfig.modResults = IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: relativeFilePath,
        groupName: projectName,
        project: xcodeConfig.modResults,
      })
    }
    setObjectiveCppFileType(xcodeConfig.modResults, relativeFilePath)
    return xcodeConfig
  })

  return withDangerousMod(config, ["ios", async (dangerousConfig) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(
      dangerousConfig.modRequest.projectRoot
    )
    const destination = path.join(
      dangerousConfig.modRequest.platformProjectRoot,
      projectName,
      IOS_SOURCE_FILE_NAME
    )
    await fs.promises.writeFile(destination, iosSource, "utf8")
    return dangerousConfig
  }])
}

function setObjectiveCppFileType(project, relativeFilePath) {
  const normalizedPath = relativeFilePath.replaceAll("\\", "/")
  const fileReferences = project.pbxFileReferenceSection()

  for (const reference of Object.values(fileReferences)) {
    if (!reference || typeof reference !== "object") continue

    const referencePath = String(reference.path ?? "")
      .replaceAll('"', "")
      .replaceAll("\\", "/")
    if (referencePath !== normalizedPath) continue

    reference.fileEncoding = 4
    reference.lastKnownFileType = "sourcecode.cpp.objcpp"
    delete reference.explicitFileType
  }
}

module.exports = function withMessageSelectionMenu(config) {
  config = withMainActivity(config, (activityConfig) => {
    if (activityConfig.modResults.language !== "kt") {
      throw new Error("Android message selection menu requires a Kotlin MainActivity")
    }
    activityConfig.modResults.contents = addMessageSelectionActivityCode(
      activityConfig.modResults.contents
    )
    return activityConfig
  })

  config = withStringsXml(config, (stringsConfig) => {
    stringsConfig.modResults.resources = addMessageSelectionStrings(
      stringsConfig.modResults.resources
    )
    return stringsConfig
  })

  return withIosMessageSelectionMenu(config)
}

module.exports.addMessageSelectionActivityCode = addMessageSelectionActivityCode
module.exports.addMessageSelectionStrings = addMessageSelectionStrings
module.exports.iosSource = iosSource
