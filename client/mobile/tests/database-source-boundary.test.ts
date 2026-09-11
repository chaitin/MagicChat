import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import ts from "typescript"

const sourceRoot = path.resolve(process.cwd(), "src")
const databaseServiceDirectory = path.join(sourceRoot, "data", "database")
const sqliteOwner = path.join(databaseServiceDirectory, "database-service.ts")

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(target)
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [target] : []
  }))
  return nested.flat()
}

function staticString(node: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isParenthesizedExpression(node)) return staticString(node.expression)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left)
    const right = staticString(node.right)
    return left === undefined || right === undefined ? undefined : left + right
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}

function importedModules(file: string, source: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const modules: string[] = []
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      modules.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require"
      if (isDynamicImport || isRequire) {
        const moduleName = staticString(node.arguments[0])
        if (moduleName) modules.push(moduleName)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return modules
}

test("only the database service imports expo-sqlite or database internals", async () => {
  const violations: string[] = []
  for (const file of await sourceFiles(sourceRoot)) {
    const imports = importedModules(file, await readFile(file, "utf8"))
    for (const moduleName of imports) {
      if (moduleName === "expo-sqlite" && file !== sqliteOwner) violations.push(`${path.relative(sourceRoot, file)} -> ${moduleName}`)
      if (moduleName.includes("database-service-core") && !file.startsWith(`${databaseServiceDirectory}${path.sep}`)) {
        violations.push(`${path.relative(sourceRoot, file)} -> ${moduleName}`)
      }
    }
  }
  assert.deepEqual(violations, [])
})

test("feature stores do not own global database schema or versioning", async () => {
  const violations: string[] = []
  for (const feature of ["messages", "contacts", "projects", "conversations"]) {
    const directory = path.join(sourceRoot, "data", feature)
    for (const file of await sourceFiles(directory)) {
      const source = await readFile(file, "utf8")
      if (/PRAGMA\s+user_version|CREATE\s+TABLE|\b(?:MESSAGE_CACHE_)?DATABASE_VERSION\b/i.test(source)) {
        violations.push(path.relative(sourceRoot, file))
      }
    }
  }
  assert.deepEqual(violations, [])
})

test("database operation names are non-empty string literals", async () => {
  const violations: string[] = []
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, "utf8")
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ["read", "write", "transaction", "maintenance"].includes(node.expression.name.text)) {
        const receiver = node.expression.expression.getText(tree)
        if ((receiver === "databaseService" || receiver === "service")
          && (!node.arguments[0] || !ts.isStringLiteralLike(node.arguments[0]) || !node.arguments[0].text.trim())) {
          const position = tree.getLineAndCharacterOfPosition(node.getStart(tree))
          violations.push(`${path.relative(sourceRoot, file)}:${position.line + 1}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  assert.deepEqual(violations, [])
})

const serviceMethods = new Set(["read", "write", "transaction", "maintenance"])

function databaseServiceBindings(tree: ts.SourceFile) {
  const services = new Set<string>()
  const methods = new Set<string>()
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || !statement.moduleSpecifier.text.endsWith("/data/database/database-service")) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) {
        if ((binding.propertyName?.text ?? binding.name.text) === "databaseService") services.add(binding.name.text)
      }
    }
  }
  let changed = true
  while (changed) {
    changed = false
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.name) && ts.isIdentifier(node.initializer) && services.has(node.initializer.text)
          && !services.has(node.name.text)) {
          services.add(node.name.text); changed = true
        }
        if (ts.isObjectBindingPattern(node.name) && ts.isIdentifier(node.initializer) && services.has(node.initializer.text)) {
          for (const element of node.name.elements) {
            const method = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text
              : ts.isIdentifier(element.name) ? element.name.text : ""
            if (serviceMethods.has(method) && ts.isIdentifier(element.name) && !methods.has(element.name.text)) {
              methods.add(element.name.text); changed = true
            }
          }
        }
        if (ts.isIdentifier(node.name) && ts.isPropertyAccessExpression(node.initializer)
          && ts.isIdentifier(node.initializer.expression) && services.has(node.initializer.expression.text)
          && serviceMethods.has(node.initializer.name.text) && !methods.has(node.name.text)) {
          methods.add(node.name.text); changed = true
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  return { services, methods }
}

function serviceCall(node: ts.Node, bindings: ReturnType<typeof databaseServiceBindings>) {
  if (!ts.isCallExpression(node)) return false
  if (ts.isIdentifier(node.expression)) return bindings.methods.has(node.expression.text)
  return ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && bindings.services.has(node.expression.expression.text)
    && serviceMethods.has(node.expression.name.text)
}

test("transaction callbacks use only their scoped transaction capability", async () => {
  const violations: string[] = []
  for (const file of await sourceFiles(sourceRoot)) {
    const tree = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true)
    const bindings = databaseServiceBindings(tree)
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === "transaction" && ts.isIdentifier(node.expression.expression)
        && bindings.services.has(node.expression.expression.text)) {
        const callback = node.arguments[1]
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          const inspect = (child: ts.Node) => {
            // Any top-level service access is invalid, including aliases and access after await.
            if (serviceCall(child, bindings)) {
              const position = tree.getLineAndCharacterOfPosition(child.getStart(tree))
              violations.push(`${path.relative(sourceRoot, file)}:${position.line + 1}`)
            }
            ts.forEachChild(child, inspect)
          }
          inspect(callback.body)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  assert.deepEqual(violations, [])
})

test("features and realtime do not write manager-owned core Query projections directly", async () => {
  const violations: string[] = []
  for (const directory of [path.join(sourceRoot, "features"), path.join(sourceRoot, "realtime")]) {
    for (const file of await sourceFiles(directory)) {
      const source = await readFile(file, "utf8")
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && ["setQueryData", "removeQueries"].includes(node.expression.name.text)) {
          const call = node.getText(tree)
          if (/queryKeys\.(?:contacts|conversations|projects)\s*\(/.test(call)) {
            const position = tree.getLineAndCharacterOfPosition(node.getStart(tree))
            violations.push(`${path.relative(sourceRoot, file)}:${position.line + 1}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(tree)
    }
  }
  assert.deepEqual(violations, [])
})

test("data database and message modules do not bypass unified telemetry with console", async () => {
  const violations: string[] = []
  for (const directory of [path.join(sourceRoot, "data", "database"), path.join(sourceRoot, "data", "messages")]) {
    for (const file of await sourceFiles(directory)) {
      if (file.endsWith(`${path.sep}database-telemetry.ts`)) continue
      const tree = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true)
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "console") {
          const position = tree.getLineAndCharacterOfPosition(node.getStart(tree))
          violations.push(`${path.relative(sourceRoot, file)}:${position.line + 1}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(tree)
    }
  }
  assert.deepEqual(violations, [])
})
