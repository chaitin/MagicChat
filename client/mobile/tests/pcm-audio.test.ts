import assert from "node:assert/strict"
import test from "node:test"

import {
  decodeFloat32Mono,
  PCM16StreamEncoder,
} from "../src/domain/audio/pcm-audio.ts"

test("resamples 48 kHz PCM to 16 kHz in 200 ms frames", () => {
  const encoder = new PCM16StreamEncoder(48_000)
  const frames = encoder.push(new Float32Array(9_600).fill(0.25))

  assert.equal(frames.length, 1)
  assert.equal(frames[0]?.byteLength, 6_400)
  assert.equal(encoder.flush().length, 0)
})

test("encodes signed samples as little-endian PCM S16LE", () => {
  const encoder = new PCM16StreamEncoder(16_000)
  encoder.push(new Float32Array([-1, 0, 1, 0]))

  const [frame] = encoder.flush()
  const view = new DataView(frame!)
  assert.equal(view.getInt16(0, true), -32_768)
  assert.equal(view.getInt16(2, true), 0)
  assert.equal(view.getInt16(4, true), 32_767)
})

test("preserves resampling position across source chunks", () => {
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

  assert.deepEqual(chunkedBytes, wholeBytes)
  assert.equal(chunkedBytes.byteLength % 2, 0)
})

test("downmixes interleaved input channels before encoding", () => {
  const stereo = new Float32Array([1, -1, 0.75, 0.25])
  const mono = decodeFloat32Mono(stereo.buffer, 2)

  assert.deepEqual([...mono], [0, 0.5])
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
