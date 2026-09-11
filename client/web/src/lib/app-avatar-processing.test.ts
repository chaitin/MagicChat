import { describe, expect, it } from "vitest"

import { calculateCenterSquareCrop } from "@/lib/app-avatar-processing"

describe("application avatar processing", () => {
  it("crops equal amounts from both sides of a wide image", () => {
    expect(calculateCenterSquareCrop(1200, 800)).toEqual({
      size: 800,
      x: 200,
      y: 0,
    })
  })

  it("crops equal amounts from the top and bottom of a tall image", () => {
    expect(calculateCenterSquareCrop(600, 1000)).toEqual({
      size: 600,
      x: 0,
      y: 200,
    })
  })
})
