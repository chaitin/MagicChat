package cloud.baizhi.fontfallback;

import android.os.Build;
import android.text.Spannable;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import com.facebook.react.ReactPackage;
import com.facebook.react.ViewManagerOnDemandReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.shell.MainReactPackage;
import com.facebook.react.uimanager.ViewManager;
import com.facebook.react.views.text.ReactTextViewManagerCallback;
import com.facebook.react.views.text.internal.span.TextInlineViewPlaceholderSpan;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** Keeps Fabric inline View frames in DP, just like the actual View hierarchy. */
public final class InlineViewTextPackage implements ReactPackage, ViewManagerOnDemandReactPackage {
  private static final List<String> NAMES = Arrays.asList("RCTText", "RCTSelectableText");
  private final MainReactPackage defaults = new MainReactPackage();

  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext context) {
    return Collections.emptyList();
  }

  @Override
  public List<String> getViewManagerNames(ReactApplicationContext context) {
    return NAMES;
  }

  @Override
  public List<ViewManager> createViewManagers(ReactApplicationContext context) {
    return Arrays.asList(createViewManager(context, NAMES.get(0)), createViewManager(context, NAMES.get(1)));
  }

  @Override
  public ViewManager createViewManager(ReactApplicationContext context, String name) {
    if (!NAMES.contains(name)) return null;
    ViewManager manager = defaults.createViewManager(context, name);
    if (manager == null) throw new IllegalStateException("Missing native text manager: " + name);
    ReactTextViewManagerCallback callback = text -> correctInlineViewFrames(text, context.getResources().getDisplayMetrics());
    try {
      // Use the default manager class so prepared layout and native selection stay unchanged.
      return (ViewManager) manager.getClass().getConstructor(ReactTextViewManagerCallback.class).newInstance(callback);
    } catch (ReflectiveOperationException error) {
      throw new IllegalStateException("Native text manager does not support a spannable callback", error);
    }
  }

  private static void correctInlineViewFrames(Spannable text, DisplayMetrics metrics) {
    for (TextInlineViewPlaceholderSpan span : text.getSpans(0, text.length(), TextInlineViewPlaceholderSpan.class)) {
      int start = text.getSpanStart(span);
      int end = text.getSpanEnd(span);
      int flags = text.getSpanFlags(span);
      // RN 0.86 turns View DP dimensions into SP pixels regardless of allowFontScaling.
      // Recover DP pixels before line breaking. The upper pixel bound avoids truncation overlap.
      int width = span.getWidth() == 0 ? 0 : (int) Math.ceil(toSp(span.getWidth() + 1, metrics) * metrics.density);
      int height = Math.round(toSp(span.getHeight(), metrics) * metrics.density);
      text.removeSpan(span);
      text.setSpan(new TextInlineViewPlaceholderSpan(span.getReactTag(), width, height), start, end, flags);
    }
  }

  private static float toSp(float pixels, DisplayMetrics metrics) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      return TypedValue.deriveDimension(TypedValue.COMPLEX_UNIT_SP, pixels, metrics);
    }
    return pixels / metrics.scaledDensity;
  }
}
