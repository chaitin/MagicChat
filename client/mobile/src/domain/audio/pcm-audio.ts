export const ASR_TARGET_SAMPLE_RATE = 16_000
export const ASR_FRAME_DURATION_MS = 200

const ASR_FRAME_SAMPLES =
  (ASR_TARGET_SAMPLE_RATE * ASR_FRAME_DURATION_MS) / 1_000

export class PCM16StreamEncoder {
  private readonly sourceStep: number
  private sourceBuffer = new Float32Array(0)
  private sourcePosition = 0
  private pendingSamples: number[] = []

  constructor(sourceSampleRate: number) {
    if (
      !Number.isFinite(sourceSampleRate) ||
      sourceSampleRate < ASR_TARGET_SAMPLE_RATE
    ) {
      throw new Error("音频采样率不支持")
    }
    this.sourceStep = sourceSampleRate / ASR_TARGET_SAMPLE_RATE
  }

  push(samples: Float32Array): ArrayBuffer[] {
    if (samples.length === 0) return []

    const source = new Float32Array(this.sourceBuffer.length + samples.length)
    source.set(this.sourceBuffer)
    source.set(samples, this.sourceBuffer.length)

    while (this.sourcePosition + 1 < source.length) {
      const index = Math.floor(this.sourcePosition)
      const fraction = this.sourcePosition - index
      const value =
        source[index]! * (1 - fraction) + source[index + 1]! * fraction
      this.pendingSamples.push(floatToPCM16(value))
      this.sourcePosition += this.sourceStep
    }

    const consumed = Math.min(source.length, Math.floor(this.sourcePosition))
    this.sourceBuffer = source.slice(consumed)
    this.sourcePosition -= consumed

    return this.takeCompleteFrames()
  }

  flush(): ArrayBuffer[] {
    const frames = this.takeCompleteFrames()
    if (this.pendingSamples.length > 0) {
      frames.push(encodePCM16(this.pendingSamples))
      this.pendingSamples = []
    }
    this.sourceBuffer = new Float32Array(0)
    this.sourcePosition = 0
    return frames
  }

  private takeCompleteFrames() {
    const frames: ArrayBuffer[] = []
    while (this.pendingSamples.length >= ASR_FRAME_SAMPLES) {
      frames.push(
        encodePCM16(this.pendingSamples.slice(0, ASR_FRAME_SAMPLES))
      )
      this.pendingSamples = this.pendingSamples.slice(ASR_FRAME_SAMPLES)
    }
    return frames
  }
}

export function decodeFloat32Mono(
  data: ArrayBuffer,
  channels: number
): Float32Array {
  if (!Number.isSafeInteger(channels) || channels <= 0) {
    throw new Error("音频声道数不支持")
  }
  if (data.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("音频数据格式错误")
  }

  const samples = new Float32Array(data)
  if (channels === 1) return samples
  if (samples.length % channels !== 0) {
    throw new Error("音频数据格式错误")
  }

  const mono = new Float32Array(samples.length / channels)
  for (let frame = 0; frame < mono.length; frame += 1) {
    let sum = 0
    for (let channel = 0; channel < channels; channel += 1) {
      sum += samples[frame * channels + channel]!
    }
    mono[frame] = sum / channels
  }
  return mono
}

function floatToPCM16(value: number) {
  const clamped = Math.max(-1, Math.min(1, value))
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff)
}

function encodePCM16(samples: number[]) {
  const buffer = new ArrayBuffer(samples.length * 2)
  const view = new DataView(buffer)
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true))
  return buffer
}
