// electron/ipcHandlers/auth.js
// 인증 IPC 핸들러 — 비밀번호 기반 마스터키 unlock 통합 (v0.10.0).
//
// register: 새 마스터키 생성 → 비밀번호로 wrap → DB 신규 생성 → 프로필 저장
// login   : 마스터키 unwrap → DB 오픈 → 비밀번호 검증
// logout  : 마스터키 / DB 메모리에서 폐기
//
// 자동 로그인은 비밀번호 없이 마스터키를 풀 수 없으므로 폐기 (보안 우선).

const { ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { v4: uuidv4 } = require('uuid')
const { initDatabase, migrateDatabase, closeDatabase } = require('../storage/database')
const { migratePlaintextDbToEncrypted } = require('../storage/dbMigration')
const { migratePlaintextFiles } = require('../storage/fileMigration')
const { deleteExpiredPendingMessages } = require('../storage/pendingMessages')
const { getProfile, saveProfile, verifyPassword, updatePeerId, updatePassword } = require('../storage/profile')
const {
  createMasterKey,
  saveWrappedMasterKey,
  loadWrappedMasterKey,
  rewrapMasterKey,
  migrateLegacyMasterKey,
  masterKeyFileExists,
  legacyKeyFileExists,
} = require('../crypto/masterKey')
const { stopBroadcastDiscovery } = require('../peer/broadcastDiscovery')
const { stopPeerDiscovery } = require('../peer/discovery')
const { disconnectAll } = require('../peer/wsClient')
const { closeAllServerClients } = require('../peer/wsServer')
const { clearAllPeerConnectRetryState, clearAllPendingFileRequests } = require('../utils/appUtils')
const { writePeerDebugLog } = require('../utils/peerDebugLogger')

// 마스터키가 unlock 된 상태에서 DB 를 열고 마이그레이션 / 만료정리 수행.
function openSessionDatabase(ctx, dbPath, appDataPath) {
  // 평문 DB 가 있으면 1회 SQLCipher 변환 — masterKey 필요.
  try {
    const result = migratePlaintextDbToEncrypted(dbPath, ctx.state.masterKey)
    if (result.migrated) writePeerDebugLog('auth.dbMigration.completed', { backupPath: result.backupPath })
  } catch (err) {
    writePeerDebugLog('auth.dbMigration.error', { error: err.message })
    throw new Error('DB 마이그레이션 실패: ' + err.message)
  }

  ctx.state.database = initDatabase(dbPath, ctx.state.masterKey)
  try { migrateDatabase(ctx.state.database) } catch { /* 부분 실패 무시 */ }

  // 평문 파일 일괄 암호화
  try {
    const summary = migratePlaintextFiles(appDataPath, ctx.state.masterKey)
    if (summary.converted > 0 || summary.failed > 0) {
      writePeerDebugLog('auth.fileMigration.summary', summary)
    }
  } catch (err) {
    writePeerDebugLog('auth.fileMigration.error', { error: err.message })
  }

  try { deleteExpiredPendingMessages(ctx.state.database) } catch {}
}

// peerId 복원 또는 신규 생성.
function ensurePeerId(ctx) {
  const profile = getProfile(ctx.state.database)
  if (profile?.peer_id) {
    ctx.state.peerId = profile.peer_id
    return
  }
  ctx.state.peerId = uuidv4()
  if (profile) updatePeerId(ctx.state.database, ctx.state.peerId)
}

// 세션 종료 — 마스터키 / DB 메모리에서 폐기.
function teardownSession(ctx) {
  if (ctx.state.database) {
    try { closeDatabase(ctx.state.database) } catch {}
    ctx.state.database = null
  }
  if (ctx.state.masterKey) {
    try { ctx.state.masterKey.fill(0) } catch {}
    ctx.state.masterKey = null
  }
  ctx.state.peerId = null
}

function registerAuthHandlers(ctx) {
  const appDataPath = ctx.config.appDataPath
  const dbPath = path.join(appDataPath, 'chat.db')

  // 프로필 존재 여부 — 마스터키 파일 또는 평문 DB가 있으면 "기존 사용자".
  ipcMain.handle('check-profile-exists', () => {
    if (masterKeyFileExists(appDataPath)) return true
    if (legacyKeyFileExists(appDataPath)) return true
    if (fs.existsSync(dbPath)) return true
    return false
  })

  // 최초 설정 — 닉네임/아이디/비밀번호 입력 + 마스터키 신규 생성.
  ipcMain.handle('register', (_, { username, nickname: nick, password }) => {
    if (!username?.trim() || !nick?.trim() || !password) {
      return { success: false, error: '모든 항목을 입력해주세요.' }
    }
    if (masterKeyFileExists(appDataPath)) {
      return { success: false, error: '이미 설정된 프로필이 있습니다.' }
    }

    try {
      // legacy 키체인 wrap 파일이 있으면 먼저 마이그레이션 (v0.9.x 사용자)
      if (legacyKeyFileExists(appDataPath)) {
        migrateLegacyMasterKey(appDataPath, ctx.state.safeStorage, password)
        ctx.state.masterKey = loadWrappedMasterKey(appDataPath, password)
        writePeerDebugLog('auth.legacyMigration.success', {})
      } else {
        ctx.state.masterKey = createMasterKey()
        saveWrappedMasterKey(appDataPath, ctx.state.masterKey, password)
      }

      openSessionDatabase(ctx, dbPath, appDataPath)

      // legacy 마이그레이션 케이스: 기존 프로필 인정
      const existing = getProfile(ctx.state.database)
      if (existing) {
        ensurePeerId(ctx)
        return { success: true, nickname: existing.nickname }
      }

      saveProfile(ctx.state.database, { username: username.trim(), nickname: nick.trim(), password })
      ensurePeerId(ctx)
      updatePeerId(ctx.state.database, ctx.state.peerId)
      return { success: true }
    } catch (err) {
      teardownSession(ctx)
      return { success: false, error: err.message }
    }
  })

  // 로그인 — 비밀번호로 마스터키 unwrap + DB 검증.
  ipcMain.handle('login', (_, { username, password }) => {
    if (!password) return { success: false, error: '비밀번호를 입력해주세요.' }

    try {
      // v0.9.x legacy 키체인 wrap 자동 마이그레이션
      if (!masterKeyFileExists(appDataPath) && legacyKeyFileExists(appDataPath)) {
        migrateLegacyMasterKey(appDataPath, ctx.state.safeStorage, password)
      }

      const masterKey = loadWrappedMasterKey(appDataPath, password)
      if (!masterKey) {
        return { success: false, error: '비밀번호가 올바르지 않습니다.' }
      }
      ctx.state.masterKey = masterKey

      openSessionDatabase(ctx, dbPath, appDataPath)

      const profile = getProfile(ctx.state.database)
      if (!profile) {
        teardownSession(ctx)
        return { success: false, error: '프로필이 없습니다. 먼저 등록해주세요.' }
      }
      if (!verifyPassword(ctx.state.database, username, password)) {
        teardownSession(ctx)
        return { success: false, error: '아이디 또는 비밀번호가 틀렸습니다.' }
      }

      ensurePeerId(ctx)
      return { success: true, nickname: profile.nickname }
    } catch (err) {
      teardownSession(ctx)
      return { success: false, error: err.message }
    }
  })

  // 자동 로그인 폐기 — 비밀번호 없이는 마스터키 unwrap 불가.
  ipcMain.handle('check-auto-login', () => ({ autoLogin: false }))

  // 로그아웃 — 마스터키/DB 메모리에서 폐기 + 연결 종료.
  ipcMain.handle('logout', async () => {
    stopBroadcastDiscovery()
    try { await stopPeerDiscovery() } catch {}
    disconnectAll()
    if (ctx.state.wsServerInfo) closeAllServerClients(ctx.state.wsServerInfo)
    ctx.state.peerPublicKeyMap.clear()
    clearAllPeerConnectRetryState(ctx)
    clearAllPendingFileRequests(ctx)
    ctx.state.discoveryEpoch++
    teardownSession(ctx)
  })

  // 비밀번호 변경 — 마스터키는 그대로, KEK 만 새 비밀번호로 다시 wrap.
  ipcMain.handle('update-password', (_, { currentPassword, newPassword }) => {
    const profile = getProfile(ctx.state.database)
    if (!profile) return { success: false, error: '프로필이 없습니다.' }
    const result = updatePassword(ctx.state.database, profile.username, currentPassword, newPassword)
    if (!result.success) return result
    try {
      const ok = rewrapMasterKey(appDataPath, currentPassword, newPassword)
      if (!ok) return { success: false, error: '마스터키 재포장 실패' }
    } catch (err) {
      return { success: false, error: '마스터키 재포장 실패: ' + err.message }
    }
    return { success: true }
  })
}

module.exports = { registerAuthHandlers }
