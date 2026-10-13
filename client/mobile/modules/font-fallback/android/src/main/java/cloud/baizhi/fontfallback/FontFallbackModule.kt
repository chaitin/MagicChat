package cloud.baizhi.fontfallback

import android.graphics.Typeface
import android.graphics.fonts.Font
import android.graphics.fonts.FontFamily
import android.net.Uri
import android.os.Build
import androidx.annotation.RequiresApi
import com.facebook.react.common.assets.ReactFontManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class FontFallbackModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MagicChatFontFallback")

    Function("register") { familyName: String, primaryUri: String, emojiUri: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        false
      } else {
        val primary = localFile(primaryUri)
        val emoji = localFile(emojiUri)
        val typeface = createFallback(primary, emoji)
        // Register it as a custom family so RN can apply 400/500/600 without
        // looking for synthetic `${familyName}_bold` asset files.
        ReactFontManager.getInstance().addCustomFont(familyName, typeface)
        true
      }
    }
  }

  private fun localFile(uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "Font must be a downloaded local file" }
    val path = requireNotNull(parsed.path)
    return File(path).also { require(it.isFile && it.length() > 0) }
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun createFallback(primary: File, emoji: File): Typeface {
    val primaryFont = Font.Builder(primary).build()
    val emojiFont = Font.Builder(emoji).build()
    return Typeface.CustomFallbackBuilder(FontFamily.Builder(primaryFont).build())
      .addCustomFallback(FontFamily.Builder(emojiFont).build())
      .setSystemFallback("sans-serif")
      .setStyle(primaryFont.style)
      .build()
  }
}
