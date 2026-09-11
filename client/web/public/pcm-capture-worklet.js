class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.active = false
    this.samples = []
    this.targetSamples = Math.max(128, Math.round(sampleRate / 10))
    this.port.onmessage = (event) => {
      if (event.data?.type === "start") {
        this.active = true
      } else if (event.data?.type === "flush") {
        this.active = false
        this.flush()
        this.port.postMessage({ type: "flushed" })
      }
    }
  }

  process(inputs) {
    if (!this.active) return true
    const channels = inputs[0]
    if (!channels || channels.length === 0) return true
    const length = channels[0]?.length ?? 0
    for (let index = 0; index < length; index += 1) {
      let sample = 0
      for (const channel of channels) sample += channel[index] ?? 0
      this.samples.push(sample / channels.length)
    }
    if (this.samples.length >= this.targetSamples) this.flush()
    return true
  }

  flush() {
    if (this.samples.length === 0) return
    const samples = new Float32Array(this.samples)
    this.samples = []
    this.port.postMessage({ type: "samples", samples }, [samples.buffer])
  }
}

registerProcessor("pcm-capture", PCMCaptureProcessor)
