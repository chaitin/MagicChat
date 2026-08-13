import { createHighlighterCore } from "@shikijs/core"
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript"
import python from "@shikijs/langs/python"
import githubDark from "@shikijs/themes/github-dark"
import githubLight from "@shikijs/themes/github-light"

const initialLanguageNames = new Set(["py", "python"])
const loadedLanguages = new Map<string, Promise<void>>()

// 避免 Oniguruma Wasm 在自定义协议下的异步加载链路，Python 直接随 Renderer 入口加载。
const highlighterPromise = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  langs: [python],
  themes: [githubDark, githubLight],
})
type LanguageRegistration = Parameters<Awaited<typeof highlighterPromise>["loadLanguage"]>[0]
type LanguageModule = { default: LanguageRegistration }

// 静态分包表覆盖 Shiki 内置的语言及别名；实际语法仍在首次使用时才加载。
const languageLoaders = import.meta.glob<LanguageModule>(
  "../../../node_modules/@shikijs/langs/dist/*.mjs",
)

export async function highlightMarkdownCode(code: string, language: string): Promise<string> {
  const languageLoader = getLanguageLoader(language)
  if (!languageLoader) {
    throw new Error("不支持的代码语言")
  }

  const highlighter = await highlighterPromise
  if (!initialLanguageNames.has(language)) {
    await loadLanguage(language, languageLoader, highlighter)
  }

  return highlighter.codeToHtml(code, {
    lang: language,
    themes: {
      dark: "github-dark",
      light: "github-light",
    },
  })
}

function getLanguageLoader(language: string) {
  return Object.entries(languageLoaders).find(([path]) => path.endsWith(`/${language}.mjs`))?.[1]
}

function loadLanguage(
  language: string,
  languageLoader: () => Promise<LanguageModule>,
  highlighter: Awaited<typeof highlighterPromise>,
): Promise<void> {
  const existing = loadedLanguages.get(language)
  if (existing) return existing

  const loading = languageLoader().then(({ default: languageRegistration }) =>
    highlighter.loadLanguage(languageRegistration),
  )
  loadedLanguages.set(language, loading)
  return loading
}
