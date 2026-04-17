// electron/ipcHandlers/auth.js
// 인증 관련 IPC 핸들러 — 프로필 확인, 회원가입, 로그인, 자동 로그인, 로그아웃, 비밀번호 변경

const { ipcMain } = require('electron')
const { getProfile, saveProfile, verifyPassword, updatePeerId, updateLastLogin, clearLastLogin, updatePassword } = require('../storage/profile')
const { stopBroadcastDiscovery } = require('../peer/broadcastDiscovery')
const { stopPeerDiscovery } = require('../peer/discovery')
const { disconnectAll } = require('../peer/wsClient')
const { closeAllServerClients } = require('../peer/wsServer')
const { clearAllPeerConnectRetryState } = require('../utils/appUtils')

function registerAuthHandlers(ctx) {
  // 프로필 존재 여부 확인 (앱 시작 시 첫 화면 결정용)
  ipcMain.handle('check-profile-exists', () => {
    if (!ctx.state.database) return false
    return getProfile(ctx.state.database) !== null
  })

  // 최초 설정 — 닉네임·아이디·비밀번호 저장
  ipcMain.handle('register', (_, { username, nickname: nick, password }) => {
    if (getProfile(ctx.state.database)) {
      return { success: false, error: '이미 설정된 프로필이 있습니다.' }
    }
    if (!username?.trim() || !nick?.trim() || !password) {
      return { success: false, error: '모든 항목을 입력해주세요.' }
    }
    try {
      saveProfile(ctx.state.database, { username: username.trim(), nickname: nick.trim(), password })
      updatePeerId(ctx.state.database, ctx.state.peerId)
      updateLastLogin(ctx.state.database)
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message }
    }
  })

  // 로그인 — 아이디·비밀번호 검증
  ipcMain.handle('login', (_, { username, password }) => {
    const isValid = verifyPassword(ctx.state.database, username, password)
    if (!isValid) return { success: false, error: '아이디 또는 비밀번호가 틀렸습니다.' }

    const profile = getProfile(ctx.state.database)
    updateLastLogin(ctx.state.database)
    return { success: true, nickname: profile.nickname }
  })

  // 자동 로그인 확인 — last_login_at이 24시간 이내이면 자동 로그인
  ipcMain.handle('check-auto-login', () => {
    const profile = getProfile(ctx.state.database)
    if (!profile?.last_login_at) return { autoLogin: false }
    const elapsedMs = Date.now() - profile.last_login_at
    const twentyFourHoursMs = 24 * 60 * 60 * 1000
    if (elapsedMs < twentyFourHoursMs) {
      updateLastLogin(ctx.state.database)
      return { autoLogin: true, nickname: profile.nickname }
    }
    return { autoLogin: false }
  })

  // 로그아웃 — last_login_at 초기화 + 연결 종료
  ipcMain.handle('logout', async () => {
    clearLastLogin(ctx.state.database)
    stopBroadcastDiscovery()
    await stopPeerDiscovery()
    disconnectAll()
    if (ctx.state.wsServerInfo) closeAllServerClients(ctx.state.wsServerInfo)
    ctx.state.peerPublicKeyMap.clear()
    clearAllPeerConnectRetryState(ctx)
    ctx.state.discoveryEpoch++
  })

  // 비밀번호 변경 — 기존 비밀번호 검증 후 변경
  ipcMain.handle('update-password', (_, { currentPassword, newPassword }) => {
    const profile = getProfile(ctx.state.database)
    if (!profile) return { success: false, error: '프로필이 없습니다.' }
    const result = updatePassword(ctx.state.database, profile.username, currentPassword, newPassword)
    // 비밀번호 변경 성공 시 자동 로그인 세션 무효화
    if (result.success) clearLastLogin(ctx.state.database)
    return result
  })
}

module.exports = { registerAuthHandlers }
