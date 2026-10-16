import { pathToFileURL } from "node:url"
import { resolve as resolvePath, extname } from "node:path"
import { existsSync } from "node:fs"

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return {
      shortCircuit: true,
      url: pathToFileURL(
        resolvePath(process.cwd(), "src", `${specifier.slice(2)}.ts`)
      ).href,
    }
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !extname(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL)
    if (existsSync(url)) return nextResolve(url.href, context)
  }
  return nextResolve(specifier, context)
}
