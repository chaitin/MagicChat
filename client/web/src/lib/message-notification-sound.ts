import { isMessageNotificationSoundEnabled } from "@/lib/message-notification-preferences"

const messageNotificationSoundURL = "/assets/sounds/message-notification.ogg"

let messageNotificationAudio: HTMLAudioElement | null = null

export function prepareMessageNotificationSound() {
  if (!isMessageNotificationSoundEnabled()) {
    return
  }
  getMessageNotificationAudio()
}

export function playMessageNotificationSound() {
  if (!isMessageNotificationSoundEnabled()) {
    return
  }
  const audio = getMessageNotificationAudio()
  if (!audio) {
    return
  }

  try {
    audio.currentTime = 0
    void audio.play().catch(() => undefined)
  } catch {
    // Browsers may reject media playback until the page receives a user gesture.
  }
}

function getMessageNotificationAudio() {
  if (messageNotificationAudio) {
    return messageNotificationAudio
  }
  if (typeof Audio === "undefined") {
    return null
  }

  try {
    const audio = new Audio(messageNotificationSoundURL)
    audio.preload = "auto"
    messageNotificationAudio = audio
    return audio
  } catch {
    return null
  }
}
