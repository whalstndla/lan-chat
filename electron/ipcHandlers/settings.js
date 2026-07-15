// electron/ipcHandlers/settings.js
// 알림 설정 관련 IPC 핸들러 — 조회, 저장, 커스텀 사운드 저장

const { ipcMain } = require('electron')
const { getNotificationSettings, saveNotificationSettings, saveCustomNotificationSound, getLinkPreviewEnabled, setLinkPreviewEnabled } = require('../storage/profile')

function registerSettingsHandlers(ctx) {
  // 알림 설정 조회
  ipcMain.handle('get-notification-settings', () =>
    getNotificationSettings(ctx.state.database, ctx.config.appDataPath)
  )

  // 알림 설정 저장 — scope(알림 범위)/hideBody(본문 숨김)는 선택 필드(#42)
  ipcMain.handle('save-notification-settings', (_, { sound, volume, scope, hideBody }) => {
    saveNotificationSettings(ctx.state.database, { sound, volume, scope, hideBody })
  })

  // 커스텀 사운드 파일 저장 — 허용 확장자 검증 (경로 탈출 방지)
  ipcMain.handle('save-custom-notification-sound', (_, { buffer, extension }) => {
    const allowedExtensions = ['mp3', 'ogg', 'wav']
    if (!allowedExtensions.includes(String(extension).toLowerCase())) {
      return { success: false, error: '허용되지 않는 파일 형식입니다.' }
    }
    saveCustomNotificationSound(ctx.state.database, ctx.config.appDataPath, buffer, extension)
  })

  // 뮤트된 채팅방 집합 동기화 — mutedRooms 는 renderer localStorage 에만 저장되므로,
  // main 프로세스의 소리/OS알림 억제 판정을 위해 토글 시 + 앱 시작 시 전체를 전달받는다(#4).
  ipcMain.handle('set-muted-rooms', (_, mutedRoomKeys) => {
    ctx.state.mutedRoomKeySet = new Set(Array.isArray(mutedRoomKeys) ? mutedRoomKeys : [])
  })

  // 링크 미리보기(외부 서버 OG 요청) 사용 여부 조회/저장 — SSRF/프라이버시 옵션(#66)
  ipcMain.handle('get-link-preview-enabled', () => getLinkPreviewEnabled(ctx.state.database))

  ipcMain.handle('set-link-preview-enabled', (_, enabled) => {
    setLinkPreviewEnabled(ctx.state.database, !!enabled)
    return true
  })
}

module.exports = { registerSettingsHandlers }
