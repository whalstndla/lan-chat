// electron/ipcHandlers/history.js
// 채팅 기록 조회 관련 IPC 핸들러 — 전체채팅, DM, DM 상대 목록, 메시지 검색

const { ipcMain } = require('electron')
const { getGlobalHistory, getDMHistory, getDMPeers, searchMessages } = require('../storage/queries')
const { deriveSharedSecret, decryptDM } = require('../crypto/encryption')
const { rewriteFileUrl } = require('../utils/appUtils')

function registerHistoryHandlers(ctx) {
  // 전체채팅 기록 조회
  ipcMain.handle('get-global-history', (_, params) => {
    const limit = params?.limit || 100
    const offset = params?.offset || 0
    const history = getGlobalHistory(ctx.state.database, limit, offset)
    return history.map(msg => ({
      ...msg,
      file_url: rewriteFileUrl(ctx, msg.file_url),
    }))
  })

  // DM 기록 조회 (복호화 포함)
  ipcMain.handle('get-dm-history', (_, { peerId1, peerId2, limit, offset }) => {
    const history = getDMHistory(ctx.state.database, peerId1, peerId2, limit || 100, offset || 0)
    // peerId1 = 나, peerId2 = 상대방
    const otherPublicKey = ctx.state.peerPublicKeyMap.get(peerId2)

    return history.map(msg => {
      // DB의 read (0/1) → boolean 변환
      const readFlag = !!msg.read
      if (msg.encrypted_payload && otherPublicKey) {
        try {
          const sharedSecret = deriveSharedSecret(ctx.state.myPrivateKey, otherPublicKey)
          let decryptedPayload

          // 송신자/수신자 peerId를 정확하게 전달 (HKDF 키 도출에 사용)
          const senderIdForDecrypt = msg.from_id
          const recipientIdForDecrypt = msg.from_id === peerId1 ? peerId2 : peerId1
          try {
            decryptedPayload = decryptDM(msg.encrypted_payload, sharedSecret, senderIdForDecrypt, recipientIdForDecrypt)
          } catch {
            // 신규 방식 실패 → 레거시(peerId 없는) 방식으로 재시도 (업데이트 전 메시지 호환)
            try {
              decryptedPayload = decryptDM(msg.encrypted_payload, sharedSecret)
            } catch (err) {
              console.warn(`[히스토리] 복호화 실패: msgId=${msg.id}`, err.message)
              return { ...msg, read: readFlag, content: null, decryptionFailed: true }
            }
          }

          return {
            ...msg,
            read: readFlag,
            content: decryptedPayload.content,
            contentType: decryptedPayload.contentType || msg.content_type,
            fileUrl: rewriteFileUrl(ctx, decryptedPayload.fileUrl || msg.file_url),
            fileName: decryptedPayload.fileName || msg.file_name,
          }
        } catch (err) {
          console.warn(`[히스토리] sharedSecret 도출 실패: msgId=${msg.id}`, err.message)
        }
      }
      return { ...msg, read: readFlag, file_url: rewriteFileUrl(ctx, msg.file_url) }
    })
  })

  // 과거 DM 상대 목록 조회 (오프라인 포함)
  ipcMain.handle('get-dm-peers', () => getDMPeers(ctx.state.database, ctx.state.peerId))

  // 메시지 전문 검색 (FTS5)
  ipcMain.handle('search-messages', (_, { query, type }) => {
    const results = searchMessages(ctx.state.database, { query, type })
    return results.map(msg => ({ ...msg, file_url: rewriteFileUrl(ctx, msg.file_url) }))
  })
}

module.exports = { registerHistoryHandlers }
