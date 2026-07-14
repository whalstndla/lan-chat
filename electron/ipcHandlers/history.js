// electron/ipcHandlers/history.js
// 채팅 기록 조회 관련 IPC 핸들러 — 전체채팅, DM, DM 상대 목록, 메시지 검색

const { ipcMain } = require('electron')
const { getGlobalHistory, getDMHistory, getDMPeers, searchMessages, getAllDMMessagesForSearch } = require('../storage/queries')
const { deriveSharedSecret, decryptDM } = require('../crypto/encryption')
const { rewriteFileUrl } = require('../utils/appUtils')

// DM 검색 결과 목록에 노출할 최대 건수 — 전역 searchMessages() 의 기본 limit(50)과 동일하게 맞춘다.
const DM_SEARCH_RESULT_LIMIT = 50

// DM 메시지 레코드 하나를 복호화 — get-dm-history / search-dm-messages 공용 로직.
// peerId1 = 나, peerId2 = 상대방. encrypted_payload 가 없거나 상대 공개키를 모르면
// (레거시 평문 DM 또는 키 교환 이전 오프라인 캐시) 원본 그대로 반환한다.
function decryptDMRecord(ctx, msg, peerId1, peerId2) {
  const readFlag = !!msg.read
  const otherPublicKey = ctx.state.peerPublicKeyMap.get(peerId2)

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

      // 수정된 메시지는 encrypted_payload 가 수정 전 원문 그대로 남아있다 (수정은
      // editMessage 가 평문 content 컬럼만 갱신하고 payload 재암호화는 하지 않기 때문 —
      // 재암호화는 상대 마스터키 접근이 필요해 불가능). 여기서 복호화 결과로 content 를
      // 덮어쓰면 재시작 후 수정 전 내용으로 롤백되어 보이므로, edited_at 이 있으면
      // 이미 정확한 값이 저장돼 있는 content 컬럼을 그대로 사용한다.
      const displayContent = msg.edited_at ? msg.content : decryptedPayload.content

      return {
        ...msg,
        read: readFlag,
        content: displayContent,
        contentType: decryptedPayload.contentType || msg.content_type,
        fileUrl: rewriteFileUrl(ctx, decryptedPayload.fileUrl || msg.file_url, msg.from_id),
        fileName: decryptedPayload.fileName || msg.file_name,
      }
    } catch (err) {
      console.warn(`[히스토리] sharedSecret 도출 실패: msgId=${msg.id}`, err.message)
    }
  }
  return { ...msg, read: readFlag, file_url: rewriteFileUrl(ctx, msg.file_url, msg.from_id) }
}

function registerHistoryHandlers(ctx) {
  // 전체채팅 기록 조회
  ipcMain.handle('get-global-history', (_, params) => {
    const limit = params?.limit || 100
    const offset = params?.offset || 0
    const history = getGlobalHistory(ctx.state.database, limit, offset)
    return history.map(msg => ({
      ...msg,
      file_url: rewriteFileUrl(ctx, msg.file_url, msg.from_id),
    }))
  })

  // DM 기록 조회 (복호화 포함)
  ipcMain.handle('get-dm-history', (_, { peerId1, peerId2, limit, offset }) => {
    const history = getDMHistory(ctx.state.database, peerId1, peerId2, limit || 100, offset || 0)
    return history.map(msg => decryptDMRecord(ctx, msg, peerId1, peerId2))
  })

  // 과거 DM 상대 목록 조회 (오프라인 포함)
  ipcMain.handle('get-dm-peers', () => getDMPeers(ctx.state.database, ctx.state.peerId))

  // 메시지 전문 검색 (FTS5)
  ipcMain.handle('search-messages', (_, { query, type }) => {
    const results = searchMessages(ctx.state.database, { query, type })
    return results.map(msg => ({ ...msg, file_url: rewriteFileUrl(ctx, msg.file_url, msg.from_id) }))
  })

  // DM 전체 기간 검색(#35) — DM 은 암호화 저장이라 FTS 인덱싱이 안 되므로, 상대와 나눈 전체
  // DM 레코드를 main 프로세스에서 복호화하며 순차 검색한다. 결과는 전역 검색과 동일한 필드
  // 형식(id/from_name/content/timestamp/file_name 등)으로 반환해 ChatSearchBar UI 를 그대로 재사용한다.
  ipcMain.handle('search-dm-messages', (_, { peerId, query }) => {
    if (!query?.trim() || !peerId) return []
    const myPeerId = ctx.state.peerId
    const lowerQuery = query.trim().toLowerCase()
    const records = getAllDMMessagesForSearch(ctx.state.database, myPeerId, peerId)

    const results = []
    for (const record of records) {
      const decrypted = decryptDMRecord(ctx, record, myPeerId, peerId)
      if (decrypted.decryptionFailed) continue

      const content = decrypted.content || ''
      const fileName = decrypted.fileName || decrypted.file_name || ''
      if (!content.toLowerCase().includes(lowerQuery) && !fileName.toLowerCase().includes(lowerQuery)) continue

      results.push({
        id: decrypted.id,
        type: decrypted.type,
        from_id: decrypted.from_id,
        from_name: decrypted.from_name,
        to_id: decrypted.to_id,
        content,
        content_type: decrypted.contentType || decrypted.content_type,
        file_name: fileName || decrypted.file_name,
        file_url: decrypted.fileUrl || decrypted.file_url,
        timestamp: decrypted.timestamp,
      })
      if (results.length >= DM_SEARCH_RESULT_LIMIT) break
    }
    return results
  })
}

module.exports = { registerHistoryHandlers }
