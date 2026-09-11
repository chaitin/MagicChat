export const asrTargetSampleRate = 16_000
export const asrFrameDurationMS = 200

const asrFrameSamples = (asrTargetSampleRate * asrFrameDurationMS) / 1_000

export class PCM16StreamEncoder {
  private readonly sourceStep: number
  private sourceBuffer = new Float32Array(0)
  private sourcePosition = 0
  private pendingSamples: number[] = []

  constructor(sourceSampleRate: number) {
    if (
      !Number.isFinite(sourceSampleRate) ||
      sourceSampleRate < asrTargetSampleRate
    ) {
      throw new Error("音频采样率不支持")
    }
    this.sourceStep = sourceSampleRate / asrTargetSampleRate
  }

  push(samples: Float32Array): ArrayBuffer[] {
    if (samples.length === 0) {
      return []
    }

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
    while (this.pendingSamples.length >= asrFrameSamples) {
      frames.push(encodePCM16(this.pendingSamples.slice(0, asrFrameSamples)))
      this.pendingSamples = this.pendingSamples.slice(asrFrameSamples)
    }
    return frames
  }
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
