package cloud.baizhi.fontfallback

import android.graphics.Typeface
import android.icu.lang.UCharacter
import android.icu.lang.UProperty
import android.icu.text.BreakIterator
import android.net.Uri
import android.os.Build
import android.text.Editable
import android.text.Spanned
import android.text.TextPaint
import android.text.TextUtils
import android.text.TextWatcher
import android.text.method.PasswordTransformationMethod
import android.text.style.MetricAffectingSpan
import android.view.ViewTreeObserver
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.views.textinput.ReactEditText
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.lang.ref.WeakReference
import java.util.Locale
import java.util.WeakHashMap

class FontFallbackModule : Module() {
  private var emojiTypeface: Typeface? = null
  private val watchers = WeakHashMap<ReactEditText, EmojiWatcher>()
  private val inputs = mutableMapOf<Int, WeakReference<ReactEditText>>()

  override fun definition() = ModuleDefinition {
    Name("MagicChatFontFallback")

    Function("registerEmoji") { emojiUri: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        false
      } else {
        emojiTypeface = Typeface.createFromFile(localFile(emojiUri))
        true
      }
    }

    Function("attachInput") { tag: Int ->
      val context = appContext.reactContext as? ReactContext
      if (context != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        UiThreadUtil.runOnUiThread {
          val typeface = emojiTypeface ?: return@runOnUiThread
          val input = runCatching {
            UIManagerHelper.getUIManagerForReactTag(context, tag)?.resolveView(tag)
          }.getOrNull() as? ReactEditText ?: return@runOnUiThread
          val watcher = watchers[input] ?: EmojiWatcher(input, typeface).also {
            watchers[input] = it
            inputs[tag] = WeakReference(input)
            input.addTextChangedListener(it)
          }
          watcher.observe(input.viewTreeObserver)
          watcher.afterTextChanged(input.text)
        }
      }
    }

    Function("detachInput") { tag: Int ->
      UiThreadUtil.runOnUiThread {
        inputs.remove(tag)?.get()?.let { input ->
          watchers.remove(input)?.let {
            it.dispose()
            input.removeTextChangedListener(it)
          }
          removeEmojiSpans(input.text)
        }
      }
    }

    OnDestroy {
      UiThreadUtil.runOnUiThread {
        watchers.entries.toList().forEach { (input, watcher) ->
          watcher.dispose()
          input.removeTextChangedListener(watcher)
          removeEmojiSpans(input.text)
        }
        watchers.clear()
        inputs.clear()
      }
    }
  }

  private fun localFile(uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "Font must be a downloaded local file" }
    val path = requireNotNull(parsed.path)
    return File(path).also { require(it.isFile && it.length() > 0) }
  }
}

private fun removeEmojiSpans(text: Editable?): Int {
  if (text == null) return 0
  val spans = text.getSpans(0, text.length, EmojiTypefaceSpan::class.java)
  spans.forEach { text.removeSpan(it) }
  return spans.size
}

@RequiresApi(Build.VERSION_CODES.Q)
private class EmojiWatcher(input: ReactEditText, private val typeface: Typeface) : TextWatcher, ViewTreeObserver.OnPreDrawListener {
  private val input = WeakReference(input)
  private val boundaries = BreakIterator.getCharacterInstance(Locale.ROOT)
  private var observer: WeakReference<ViewTreeObserver>? = null
  private var lastEditable: WeakReference<Editable>? = null
  private var lastValue: String? = null
  private var lastMasked: Boolean? = null
  private var spanCount = 0

  fun observe(tree: ViewTreeObserver) {
    if (observer?.get() === tree) return
    observer?.get()?.takeIf { it.isAlive }?.removeOnPreDrawListener(this)
    observer = WeakReference(tree)
    tree.addOnPreDrawListener(this)
  }

  fun dispose() {
    observer?.get()?.takeIf { it.isAlive }?.removeOnPreDrawListener(this)
    observer = null
    lastEditable = null
    lastValue = null
  }

  override fun onPreDraw(): Boolean {
    val view = input.get() ?: run { dispose(); return true }
    if (!view.isAttachedToWindow || !view.isShown) return true
    val text = view.text ?: return true
    val masked = view.transformationMethod is PasswordTransformationMethod
    // ReactEditText suppresses TextWatcher callbacks for values supplied by JS.
    if (lastMasked != masked || lastEditable?.get() !== text || (!masked && !TextUtils.equals(lastValue, text)) ||
      text.getSpans(0, text.length, EmojiTypefaceSpan::class.java).size != spanCount) {
      return !refresh(text)
    }
    return true
  }

  override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) {}
  override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) {}

  override fun afterTextChanged(text: Editable?) {
    if (text != null) refresh(text)
  }

  private fun refresh(text: Editable): Boolean {
    val previousCount = removeEmojiSpans(text)
    spanCount = 0
    lastMasked = input.get()?.transformationMethod is PasswordTransformationMethod
    if (lastMasked == true) {
      lastEditable = WeakReference(text)
      lastValue = null
      return previousCount > 0
    }
    val value = text.toString()
    boundaries.setText(value)
    var start = boundaries.first()
    var end = boundaries.next()
    while (end != BreakIterator.DONE) {
      val cluster = value.substring(start, end)
      if (isEmoji(cluster)) {
        // Only decorate complete graphemes; never replace text, selection or IME composing spans.
        text.setSpan(EmojiTypefaceSpan(typeface), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        spanCount++
      }
      start = end
      end = boundaries.next()
    }
    lastEditable = WeakReference(text)
    lastValue = value
    return previousCount > 0 || spanCount > 0
  }

  private fun isEmoji(cluster: String): Boolean {
    if (cluster.isEmpty() || cluster.contains('\uFE0E')) return false
    val first = cluster.codePointAt(0)
    if ((first in 0x30..0x39 || first == 0x23 || first == 0x2A) &&
      (cluster == "${first.toChar()}\u20E3" || cluster == "${first.toChar()}\uFE0F\u20E3")) return true
    if (cluster.codePointCount(0, cluster.length) == 2 &&
      first in 0x1F1E6..0x1F1FF && cluster.codePointBefore(cluster.length) in 0x1F1E6..0x1F1FF) return true
    return UCharacter.hasBinaryProperty(first, UProperty.EXTENDED_PICTOGRAPHIC)
  }
}

private class EmojiTypefaceSpan(private val typeface: Typeface) : MetricAffectingSpan() {
  override fun updateDrawState(paint: TextPaint) = apply(paint)
  override fun updateMeasureState(paint: TextPaint) = apply(paint)

  private fun apply(paint: TextPaint) {
    paint.typeface = typeface
    paint.isFakeBoldText = false
    paint.textSkewX = 0f
  }
}
