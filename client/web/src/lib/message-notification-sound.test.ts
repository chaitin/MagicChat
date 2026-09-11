import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("message notification sound", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("preloads one audio element and restarts it for every new message", async () => {
    const play = vi.fn().mockResolvedValue(undefined)
    const audioSources: string[] = []
    const audioInstances: Array<{
      currentTime: number
      play: typeof play
      preload: string
    }> = []
    class AudioMock {
      currentTime = 5
      play = play
      preload = ""

      constructor(source: string) {
        audioSources.push(source)
        audioInstances.push(this)
      }
    }
    vi.stubGlobal("Audio", AudioMock)

    const { playMessageNotificationSound, prepareMessageNotificationSound } =
      await import("./message-notification-sound")

    prepareMessageNotificationSound()
    playMessageNotificationSound()
    audioInstances[0].currentTime = 3
    playMessageNotificationSound()

    expect(audioInstances).toHaveLength(1)
    expect(audioSources).toEqual(["/assets/sounds/message-notification.ogg"])
    expect(audioInstances[0].preload).toBe("auto")
    expect(audioInstances[0].currentTime).toBe(0)
    expect(play).toHaveBeenCalledTimes(2)
  })

  it("ignores a browser playback rejection", async () => {
    const play = vi.fn().mockRejectedValue(new Error("autoplay blocked"))
    class AudioMock {
      currentTime = 0
      play = play
      preload = ""
    }
    vi.stubGlobal("Audio", AudioMock)

    const { playMessageNotificationSound } =
      await import("./message-notification-sound")

    expect(() => playMessageNotificationSound()).not.toThrow()
    await Promise.resolve()
    expect(play).toHaveBeenCalledOnce()
  })

  it("does not prepare or play audio when the sound is disabled", async () => {
    const audio = vi.fn()
    vi.stubGlobal("Audio", audio)
    window.localStorage.setItem(
      "client-web:message-notification-sound-enabled",
      "false"
    )

    const { playMessageNotificationSound, prepareMessageNotificationSound } =
      await import("./message-notification-sound")

    prepareMessageNotificationSound()
    playMessageNotificationSound()

    expect(audio).not.toHaveBeenCalled()
  })
})
