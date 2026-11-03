import assert from "node:assert/strict"
import test from "node:test"
import { createSubscriptionMultiplexer } from "../src/preload/subscription-multiplexer.ts"

test("shares one underlying listener between subscribers", () => {
  let dispatch: ((value: number) => void) | undefined
  let attachCount = 0
  let detachCount = 0
  const subscribe = createSubscriptionMultiplexer<number>((next) => {
    attachCount += 1
    dispatch = next
    return () => {
      detachCount += 1
    }
  })
  const firstValues: number[] = []
  const secondValues: number[] = []

  const unsubscribeFirst = subscribe((value) => firstValues.push(value))
  const unsubscribeSecond = subscribe((value) => secondValues.push(value))

  assert.equal(attachCount, 1)
  dispatch?.(1)
  assert.deepEqual(firstValues, [1])
  assert.deepEqual(secondValues, [1])

  unsubscribeFirst()
  dispatch?.(2)
  assert.deepEqual(firstValues, [1])
  assert.deepEqual(secondValues, [1, 2])
  assert.equal(detachCount, 0)

  unsubscribeSecond()
  assert.equal(detachCount, 1)
  unsubscribeSecond()
  assert.equal(detachCount, 1)
})

test("treats repeated subscriptions of the same callback independently", () => {
  let dispatch: ((value: number) => void) | undefined
  let detachCount = 0
  const subscribe = createSubscriptionMultiplexer<number>((next) => {
    dispatch = next
    return () => {
      detachCount += 1
    }
  })
  const values: number[] = []
  const callback = (value: number) => values.push(value)

  const unsubscribeFirst = subscribe(callback)
  const unsubscribeSecond = subscribe(callback)
  dispatch?.(1)
  assert.deepEqual(values, [1, 1])

  unsubscribeFirst()
  dispatch?.(2)
  assert.deepEqual(values, [1, 1, 2])

  unsubscribeSecond()
  assert.equal(detachCount, 1)
})

test("reattaches after all subscribers have unsubscribed", () => {
  let attachCount = 0
  let detachCount = 0
  const subscribe = createSubscriptionMultiplexer<number>(() => {
    attachCount += 1
    return () => {
      detachCount += 1
    }
  })

  subscribe(() => undefined)()
  subscribe(() => undefined)()

  assert.equal(attachCount, 2)
  assert.equal(detachCount, 2)
})
