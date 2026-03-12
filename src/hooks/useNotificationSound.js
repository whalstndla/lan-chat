// src/hooks/useNotificationSound.js
import { useRef, useCallback } from 'react'
import useUserStore from '../store/useUserStore'

// 내장 사운드 파일 경로 (public/assets/sounds/ → 빌드 후 ./assets/sounds/)
const BUILT_IN_SOUND_PATHS = {
  notification1: './assets/sounds/notification1.mp3',
  notification2: './assets/sounds/notification2.mp3',
  notification3: './assets/sounds/notification3.mp3',
  notification4: './assets/sounds/notification4.mp3',
}

// 커스텀 파일(Uint8Array)을 Blob URL로 변환해 재생
function playFromBuffer(buffer, volume) {
  try {
    const blob = new Blob([buffer], { type: 'audio/mpeg' })
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.volume = volume
    audio.play().catch(() => {})
    audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true })
  } catch {
    // 재생 실패 시 무시
  }
}

// 파일 경로로 재생
function playFromPath(path, volume) {
  try {
    const audio = new Audio(path)
    audio.volume = volume
    audio.play().catch(() => {})
  } catch {
    // 재생 실패 시 무시
  }
}

export default function useNotificationSound() {
  const notificationSound = useUserStore(state => state.notificationSound)
  const notificationVolume = useUserStore(state => state.notificationVolume)
  const notificationCustomSoundBuffer = useUserStore(state => state.notificationCustomSoundBuffer)

  const play = useCallback(() => {
    if (notificationSound === 'custom' && notificationCustomSoundBuffer) {
      playFromBuffer(notificationCustomSoundBuffer, notificationVolume)
    } else {
      const path = BUILT_IN_SOUND_PATHS[notificationSound] || BUILT_IN_SOUND_PATHS.notification1
      playFromPath(path, notificationVolume)
    }
  }, [notificationSound, notificationVolume, notificationCustomSoundBuffer])

  return { play }
}
