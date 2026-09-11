import { pathToFileURL } from "node:url"
import { resolve as resolvePath } from "node:path"

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return {
      shortCircuit: true,
      url: pathToFileURL(
        resolvePath(process.cwd(), "src", `${specifier.slice(2)}.ts`)
      ).href,
    }
  }
  return nextResolve(specifier, context)
}
