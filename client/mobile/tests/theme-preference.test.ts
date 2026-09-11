import assert from "node:assert/strict"
import test from "node:test"

import {
  parseThemePreference,
  resolveThemeScheme,
  THEME_PREFERENCE_STORAGE_KEY,
} from "../src/config/theme-preference.ts"

test("theme preference parser accepts supported values and defaults invalid values", () => {
  assert.equal(parseThemePreference("system"), "system")
  assert.equal(parseThemePreference("light"), "light")
  assert.equal(parseThemePreference("dark"), "dark")
  assert.equal(parseThemePreference("sepia"), "system")
  assert.equal(parseThemePreference(null), "system")
  assert.equal(THEME_PREFERENCE_STORAGE_KEY, "@magicchat/theme-preference/v1")
})

test("theme resolver respects explicit preference and resolves system safely", () => {
  assert.equal(resolveThemeScheme("light", "dark"), "light")
  assert.equal(resolveThemeScheme("dark", "light"), "dark")
  assert.equal(resolveThemeScheme("system", "dark"), "dark")
  assert.equal(resolveThemeScheme("system", "light"), "light")
  assert.equal(resolveThemeScheme("system", null), "light")
})
