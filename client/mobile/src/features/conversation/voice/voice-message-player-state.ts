type ActiveVoicePlayer = {
  id: string
  pause: () => void
}

let activeVoicePlayer: ActiveVoicePlayer | null = null

export function activateVoicePlayer(player: ActiveVoicePlayer) {
  if (activeVoicePlayer?.id !== player.id) activeVoicePlayer?.pause()
  activeVoicePlayer = player
}

export function deactivateVoicePlayer(id: string) {
  if (activeVoicePlayer?.id === id) activeVoicePlayer = null
}

export function stopActiveVoicePlayback() {
  activeVoicePlayer?.pause()
  activeVoicePlayer = null
}
