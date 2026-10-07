// src/hooks/useNotificationSound.js
import { useCallback } from 'react'
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
  const play = useCallback(() => {
    // 설정 변경 직후의 미리듣기와 IPC 알림도 항상 최신 값을 사용한다.
    const { notificationSound, notificationVolume, notificationCustomSoundBuffer } = useUserStore.getState()
    if (notificationSound === 'custom' && notificationCustomSoundBuffer) {
      playFromBuffer(notificationCustomSoundBuffer, notificationVolume)
    } else {
      const path = BUILT_IN_SOUND_PATHS[notificationSound] || BUILT_IN_SOUND_PATHS.notification1
      playFromPath(path, notificationVolume)
    }
  }, [])

  return { play }
}
