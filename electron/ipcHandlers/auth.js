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
const { loadOrCreateEncryptedKeyPair, exportPublicKey } = require('../crypto/keyManager')
const { stopBroadcastDiscovery } = require('../peer/broadcastDiscovery')
const { stopPeerDiscovery } = require('../peer/discovery')
const { disconnectAll } = require('../peer/wsClient')
const { clearDecryptedCache } = require('../protocol/lanchatProtocol')
const { closeAllServerClients } = require('../peer/wsServer')
const { clearAllPeerConnectRetryState, clearAllPendingFileRequests, sweepOrphanedFileCache } = require('../utils/appUtils')
const { clearAllFileChunkTransfers } = require('../peer/fileChunkTransfer')
const { writePeerDebugLog } = require('../utils/peerDebugLogger')
const { disposeLanpetService } = require('../lanpet/service')

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

  // file_cache/ orphan 스윕 — 메시지 삭제 시 개별적으로 캐시 파일을 지우지만(#24),
  // 이 수정 이전에 삭제된 과거 데이터나 비정상 종료로 남은 orphan 을 로그인마다 정리.
  try {
    const sweepResult = sweepOrphanedFileCache(ctx)
    if (sweepResult.removed > 0) writePeerDebugLog('auth.fileCacheSweep.summary', sweepResult)
  } catch (err) {
    writePeerDebugLog('auth.fileCacheSweep.error', { error: err.message })
  }
}

// 마스터키 확보 이후 장기 신원키(ECDH 개인키)를 로드/생성/마이그레이션해 ctx.state 에 세팅.
// 반드시 discovery 시작(start-peer-discovery) 전에 호출돼야 hello/키교환/DM 이 정상 동작한다.
// masterKey 는 password 를 바꿔도 동일하게 유지되므로 private_key.enc 는 재포장이 필요 없다.
function loadIdentityKeyPair(ctx, appDataPath) {
  const { privateKey, publicKey } = loadOrCreateEncryptedKeyPair(appDataPath, ctx.state.masterKey)
  ctx.state.myPrivateKey = privateKey
  ctx.state.myPublicKeyBase64 = exportPublicKey(publicKey)
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
  ctx.state.isSessionClosing = true
  disposeLanpetService(ctx)
  if (ctx.state.database) {
    try { closeDatabase(ctx.state.database) } catch {}
    ctx.state.database = null
  }
  if (ctx.state.masterKey) {
    try { ctx.state.masterKey.fill(0) } catch {}
    ctx.state.masterKey = null
  }
  // 장기 신원키도 세션 종료 시 메모리에서 폐기 — 개인키가 로그인 세션 동안만 상주하도록 한다(#61).
  // KeyObject 는 Buffer 처럼 0 덮어쓰기가 불가하므로 참조를 끊어 GC 에 맡긴다.
  ctx.state.myPrivateKey = null
  ctx.state.myPublicKeyBase64 = null
  // 마스터키 폐기 시 복호화된 평문 버퍼 캐시도 비워 메모리에 평문 잔재가 남지 않게 한다.
  try { clearDecryptedCache() } catch {}
  ctx.state.peerId = null
  // 로그아웃 시 auto-away 추적 상태도 초기화 — 다음 로그인 세션에 영향 없도록(#41)
  ctx.state.isAutoAway = false
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
  ipcMain.handle('register', async (_, { username, nickname: nick, password }) => {
    if (!username?.trim() || !nick?.trim() || !password) {
      return { success: false, error: '모든 항목을 입력해주세요.' }
    }
    if (masterKeyFileExists(appDataPath)) {
      return { success: false, error: '이미 설정된 프로필이 있습니다.' }
    }

    try {
      // legacy 키체인 wrap 파일이 있으면 먼저 마이그레이션 (v0.9.x 사용자)
      if (legacyKeyFileExists(appDataPath)) {
        await migrateLegacyMasterKey(appDataPath, ctx.state.safeStorage, password)
        ctx.state.masterKey = await loadWrappedMasterKey(appDataPath, password)
        writePeerDebugLog('auth.legacyMigration.success', {})
      } else {
        ctx.state.masterKey = createMasterKey()
        await saveWrappedMasterKey(appDataPath, ctx.state.masterKey, password)
      }

      openSessionDatabase(ctx, dbPath, appDataPath)

      // 신원키 로드/생성 — discovery 시작 전에 개인키가 준비되도록 여기서 세팅한다(#61).
      loadIdentityKeyPair(ctx, appDataPath)

      // legacy 마이그레이션 케이스: 기존 프로필 인정
      const existing = getProfile(ctx.state.database)
      if (existing) {
        ensurePeerId(ctx)
        ctx.state.isSessionClosing = false
        return { success: true, nickname: existing.nickname }
      }

      await saveProfile(ctx.state.database, { username: username.trim(), nickname: nick.trim(), password })
      ensurePeerId(ctx)
      updatePeerId(ctx.state.database, ctx.state.peerId)
      ctx.state.isSessionClosing = false
      return { success: true }
    } catch (err) {
      teardownSession(ctx)
      return { success: false, error: err.message }
    }
  })

  // 로그인 — 비밀번호로 마스터키 unwrap + DB 검증.
  ipcMain.handle('login', async (_, { username, password }) => {
    if (!password) return { success: false, error: '비밀번호를 입력해주세요.' }

    try {
      // v0.9.x legacy 키체인 wrap 자동 마이그레이션
      if (!masterKeyFileExists(appDataPath) && legacyKeyFileExists(appDataPath)) {
        await migrateLegacyMasterKey(appDataPath, ctx.state.safeStorage, password)
      }

      const masterKey = await loadWrappedMasterKey(appDataPath, password)
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
      if (!(await verifyPassword(ctx.state.database, username, password))) {
        teardownSession(ctx)
        return { success: false, error: '아이디 또는 비밀번호가 틀렸습니다.' }
      }

      // 검증 통과 후 신원키 로드 — discovery 시작 전에 개인키가 준비되도록 한다(#61).
      loadIdentityKeyPair(ctx, appDataPath)

      ensurePeerId(ctx)
      ctx.state.isSessionClosing = false
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
    // 진행 중인 start-peer-discovery가 stop 대기에서 깨어나도 이전 세션 요청으로 판정하게 한다.
    ctx.state.isSessionClosing = true
    disposeLanpetService(ctx)
    ctx.state.discoveryEpoch++
    stopBroadcastDiscovery()
    try { await stopPeerDiscovery() } catch {}
    disconnectAll()
    if (ctx.state.wsServerInfo) closeAllServerClients(ctx.state.wsServerInfo)
    ctx.state.peerPublicKeyMap.clear()
    // TOFU 키 변경 보류 상태도 로그아웃 시 폐기 — 다음 세션에 stale 경고가 남지 않게 한다(#59).
    ctx.state.pendingKeyChangeMap.clear()
    clearAllPeerConnectRetryState(ctx)
    clearAllPendingFileRequests(ctx)
    clearAllFileChunkTransfers(ctx)
    teardownSession(ctx)
  })

  // 비밀번호 변경 — 마스터키는 그대로, KEK 만 새 비밀번호로 다시 wrap.
  ipcMain.handle('update-password', async (_, { currentPassword, newPassword }) => {
    const profile = getProfile(ctx.state.database)
    if (!profile) return { success: false, error: '프로필이 없습니다.' }
    const result = await updatePassword(ctx.state.database, profile.username, currentPassword, newPassword)
    if (!result.success) return result
    try {
      const ok = await rewrapMasterKey(appDataPath, currentPassword, newPassword)
      if (!ok) return { success: false, error: '마스터키 재포장 실패' }
    } catch (err) {
      return { success: false, error: '마스터키 재포장 실패: ' + err.message }
    }
    return { success: true }
  })
}

module.exports = { registerAuthHandlers }
