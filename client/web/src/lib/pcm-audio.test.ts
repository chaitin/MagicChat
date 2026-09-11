import { describe, expect, it } from "vitest"

import { PCM16StreamEncoder } from "./pcm-audio"

describe("PCM16StreamEncoder", () => {
  it("resamples 48 kHz audio to 16 kHz and emits 200 ms frames", () => {
    const encoder = new PCM16StreamEncoder(48_000)
    const source = new Float32Array(9_600).fill(0.25)

    const frames = encoder.push(source)

    expect(frames).toHaveLength(1)
    expect(frames[0]?.byteLength).toBe(6_400)
    expect(encoder.flush()).toHaveLength(0)
  })

  it("encodes signed samples as little-endian PCM S16LE", () => {
    const encoder = new PCM16StreamEncoder(16_000)
    encoder.push(new Float32Array([-1, 0, 1, 0]))

    const [frame] = encoder.flush()
    const view = new DataView(frame!)
    expect(view.getInt16(0, true)).toBe(-32_768)
    expect(view.getInt16(2, true)).toBe(0)
    expect(view.getInt16(4, true)).toBe(32_767)
  })

  it("preserves resampling position across source chunks", () => {
    const source = Float32Array.from({ length: 12_000 }, (_, index) =>
      Math.sin(index / 20)
    )
    const whole = new PCM16StreamEncoder(48_000)
    const chunked = new PCM16StreamEncoder(48_000)

    const wholeBytes = flatten([...whole.push(source), ...whole.flush()])
    const chunkedBytes = flatten([
      ...chunked.push(source.slice(0, 1_337)),
      ...chunked.push(source.slice(1_337, 7_901)),
      ...chunked.push(source.slice(7_901)),
      ...chunked.flush(),
    ])

    expect(chunkedBytes).toEqual(wholeBytes)
    expect(chunkedBytes.byteLength % 2).toBe(0)
  })
})

function flatten(frames: ArrayBuffer[]) {
  const bytes = frames.map((frame) => new Uint8Array(frame))
  const result = new Uint8Array(
    bytes.reduce((length, frame) => length + frame.byteLength, 0)
  )
  let offset = 0
  for (const frame of bytes) {
    result.set(frame, offset)
    offset += frame.byteLength
  }
  return result
}
