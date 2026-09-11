import assert from "node:assert/strict"
import test from "node:test"

import {
  canStartElasticOverscroll,
  getElasticBoundary,
  getElasticTranslation,
} from "@/components/layout/elastic-overscroll-model"

test("elastic overscroll recognizes top, bottom, middle and short content", () => {
  assert.equal(getElasticBoundary({ contentHeight: 1000, viewportHeight: 500, offsetY: 0 }), "top")
  assert.equal(getElasticBoundary({ contentHeight: 1000, viewportHeight: 500, offsetY: 250 }), "none")
  assert.equal(getElasticBoundary({ contentHeight: 1000, viewportHeight: 500, offsetY: 500 }), "bottom")
  assert.equal(getElasticBoundary({ contentHeight: 300, viewportHeight: 500, offsetY: 0 }), "both")
})

test("elastic overscroll only translates outwards at a boundary", () => {
  const top = { contentHeight: 1000, viewportHeight: 500, offsetY: 0 }
  const bottom = { contentHeight: 1000, viewportHeight: 500, offsetY: 500 }
  const middle = { contentHeight: 1000, viewportHeight: 500, offsetY: 200 }
  assert.equal(getElasticTranslation(100, top), 35)
  assert.equal(getElasticTranslation(-100, top), 0)
  assert.equal(getElasticTranslation(-100, bottom), -35)
  assert.equal(getElasticTranslation(100, bottom), 0)
  assert.equal(getElasticTranslation(100, middle), 0)
})

test("elastic gesture yields to normal scrolling and only starts outwards", () => {
  const top = { contentHeight: 1000, viewportHeight: 500, offsetY: 0 }
  const bottom = { contentHeight: 1000, viewportHeight: 500, offsetY: 500 }
  const middle = { contentHeight: 1000, viewportHeight: 500, offsetY: 200 }
  assert.equal(canStartElasticOverscroll(20, top), true)
  assert.equal(canStartElasticOverscroll(-20, top), false)
  assert.equal(canStartElasticOverscroll(-20, bottom), true)
  assert.equal(canStartElasticOverscroll(20, bottom), false)
  assert.equal(canStartElasticOverscroll(20, middle), false)
  assert.equal(canStartElasticOverscroll(-20, middle), false)
})

test("elastic overscroll supports both directions for short content and clamps displacement", () => {
  const short = { contentHeight: 300, viewportHeight: 500, offsetY: 0 }
  assert.equal(getElasticTranslation(1000, short), 200)
  assert.equal(getElasticTranslation(-1000, short), -200)
})
