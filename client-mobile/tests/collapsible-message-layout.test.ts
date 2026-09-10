import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { getCollapsibleMessageLayout } from "@/features/conversation/messages/collapsible-message-layout"

const root = new URL("../", import.meta.url)

test("leaves the viewport unconstrained while natural height is being measured", () => {
  assert.deepEqual(
    getCollapsibleMessageLayout({
      contentHeight: null,
      expanded: false,
      variant: "text",
    }),
    {
      canExpand: false,
      collapsed: false,
      viewportHeight: null,
    }
  )
})

test("shrinks short content to its natural height", () => {
  assert.deepEqual(
    getCollapsibleMessageLayout({
      contentHeight: 80,
      expanded: false,
      variant: "markdown",
    }),
    {
      canExpand: false,
      collapsed: false,
      viewportHeight: 80,
    }
  )
})

test("clips long content using the variant threshold until expanded", () => {
  assert.deepEqual(
    getCollapsibleMessageLayout({
      contentHeight: 600,
      expanded: false,
      variant: "text",
    }),
    {
      canExpand: true,
      collapsed: true,
      viewportHeight: 192,
    }
  )
  assert.deepEqual(
    getCollapsibleMessageLayout({
      contentHeight: 600,
      expanded: true,
      variant: "markdown",
    }),
    {
      canExpand: true,
      collapsed: false,
      viewportHeight: 600,
    }
  )
})

test("covers the SVG fade raster edge with an opaque strip", async () => {
  const source = await readFile(
    new URL(
      "src/features/conversation/messages/collapsible-message-content.tsx",
      root
    ),
    "utf8"
  )

  assert.match(source, /styles\.fadeEdge, \{ backgroundColor: fadeColor \}/)
  assert.match(source, /fadeEdge: \{[\s\S]*?height: 1,/)
})

test("does not treat layout rounding at the threshold as overflow", () => {
  assert.equal(
    getCollapsibleMessageLayout({
      contentHeight: 241,
      expanded: false,
      variant: "markdown",
    }).canExpand,
    false
  )
  assert.equal(
    getCollapsibleMessageLayout({
      contentHeight: 242,
      expanded: false,
      variant: "markdown",
    }).canExpand,
    true
  )
})
