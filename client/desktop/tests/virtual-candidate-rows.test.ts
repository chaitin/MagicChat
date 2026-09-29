import assert from "node:assert/strict"
import test from "node:test"
import {
  CANDIDATE_ROW_HEIGHT,
  virtualCandidateRange,
} from "../src/renderer/features/chat/virtual-candidate-rows.ts"

test("large candidate lists render only the visible window", () => {
  assert.deepEqual(virtualCandidateRange(1000, 0), {
    start: 0,
    end: 12,
    height: 1000 * CANDIDATE_ROW_HEIGHT - 4,
  })
  assert.deepEqual(virtualCandidateRange(1000, 200), {
    start: 196,
    end: 212,
    height: 1000 * CANDIDATE_ROW_HEIGHT - 4,
  })
  assert.deepEqual(virtualCandidateRange(1000, 999), {
    start: 988,
    end: 1000,
    height: 1000 * CANDIDATE_ROW_HEIGHT - 4,
  })
})

test("filtering to fewer candidates keeps the window in bounds", () => {
  assert.deepEqual(virtualCandidateRange(3, 200), {
    start: 0,
    end: 3,
    height: 3 * CANDIDATE_ROW_HEIGHT - 4,
  })
  assert.deepEqual(virtualCandidateRange(0, 200), { start: 0, end: 0, height: 0 })
})
