export type PreviewToolbarHold = "hover" | "focus" | "drag" | "context-menu" | "speed-menu" | "busy"

export class PreviewToolbarVisibility {
  private timer: ReturnType<typeof setTimeout> | undefined
  private holds = new Set<PreviewToolbarHold>()
  private inside = true
  private active = true
  private visible = true
  private disposed = false
  private readonly onChange: (visible: boolean) => void

  constructor(onChange: (visible: boolean) => void) {
    this.onChange = onChange
  }

  activity() {
    if (this.disposed) return
    this.active = true
    this.inside = true
    this.update(true)
    this.schedule()
  }

  leave() {
    if (this.disposed) return
    this.inside = false
    this.clearTimer()
    if (!this.holds.size) this.update(false)
  }

  blur() {
    if (this.disposed) return
    this.active = false
    this.inside = false
    this.clearTimer()
    this.update(false)
  }

  hold(reason: PreviewToolbarHold, held: boolean) {
    if (this.disposed) return
    if (held) this.holds.add(reason)
    else this.holds.delete(reason)
    this.clearTimer()
    if (!this.active) return
    if (this.holds.size) this.update(true)
    else if (this.inside) this.schedule()
    else this.update(false)
  }

  dispose() {
    this.disposed = true
    this.clearTimer()
    this.holds.clear()
  }

  private schedule() {
    this.clearTimer()
    if (!this.holds.size)
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.update(false)
      }, 3000)
  }

  private clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private update(visible: boolean) {
    if (this.disposed || this.visible === visible) return
    this.visible = visible
    this.onChange(visible)
  }
}
