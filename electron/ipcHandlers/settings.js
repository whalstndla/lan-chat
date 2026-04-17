// electron/ipcHandlers/settings.js
// 알림 설정 관련 IPC 핸들러 — 조회, 저장, 커스텀 사운드 저장

const { ipcMain } = require('electron')
const { getNotificationSettings, saveNotificationSettings, saveCustomNotificationSound } = require('../storage/profile')

function registerSettingsHandlers(ctx) {
  // 알림 설정 조회
  ipcMain.handle('get-notification-settings', () =>
    getNotificationSettings(ctx.state.database, ctx.config.appDataPath)
  )

  // 알림 설정 저장
  ipcMain.handle('save-notification-settings', (_, { sound, volume }) => {
    saveNotificationSettings(ctx.state.database, { sound, volume })
  })

  // 커스텀 사운드 파일 저장 — 허용 확장자 검증 (경로 탈출 방지)
  ipcMain.handle('save-custom-notification-sound', (_, { buffer, extension }) => {
    const allowedExtensions = ['mp3', 'ogg', 'wav']
    if (!allowedExtensions.includes(String(extension).toLowerCase())) {
      return { success: false, error: '허용되지 않는 파일 형식입니다.' }
    }
    saveCustomNotificationSound(ctx.state.database, ctx.config.appDataPath, buffer, extension)
  })
}

module.exports = { registerSettingsHandlers }
