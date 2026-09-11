import assert from "node:assert/strict"
import test from "node:test"

import { ApiRequestError } from "../src/data/api-client.ts"
import { getClientDataBootstrapState } from "../src/providers/client-data-bootstrap.ts"

const connectionError = new ApiRequestError("offline", { kind: "connection" })

test("cached bootstrap data suppresses background connection failures", () => {
  const state = getClientDataBootstrapState([
    { available: true, error: null },
    { available: true, error: connectionError },
    { available: true, error: null },
  ])
  assert.deepEqual(state, { blockingError: null, ready: true })
})

test("missing bootstrap data exposes a connection failure", () => {
  const state = getClientDataBootstrapState([
    { available: true, error: null },
    { available: false, error: connectionError },
    { available: true, error: null },
  ])
  assert.equal(state.ready, false)
  assert.equal(state.blockingError, connectionError)
})

test("unauthorized, SQLite, parsing, and business errors are not connection failures", () => {
  for (const error of [
    new ApiRequestError("unauthorized", { status: 401 }),
    new Error("SQLite failure"),
    new ApiRequestError("invalid JSON", { status: 200 }),
    new ApiRequestError("business failure", { status: 422 }),
  ]) {
    assert.equal(
      getClientDataBootstrapState([{ available: false, error }]).blockingError,
      null
    )
  }
})

test("successful refresh closes a previous blocking failure", () => {
  const failed = getClientDataBootstrapState([
    { available: false, error: connectionError },
  ])
  const succeeded = getClientDataBootstrapState([
    { available: true, error: null },
  ])
  assert.equal(failed.blockingError, connectionError)
  assert.deepEqual(succeeded, { blockingError: null, ready: true })
})
