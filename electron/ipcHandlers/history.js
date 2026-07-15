// electron/ipcHandlers/history.js
// 채팅 기록 조회 관련 IPC 핸들러 — 전체채팅, DM, DM 상대 목록, 메시지 검색

const { ipcMain } = require('electron')
const {
  getGlobalHistory, getDMHistory, getDMPeers, searchMessages,
  getAllDMMessagesForSearch, getGlobalMessageRank, getDMMessageRank,
} = require('../storage/queries')
const { deriveSharedSecret, decryptDM } = require('../crypto/encryption')
const { rewriteFileUrl } = require('../utils/appUtils')

// DM 검색 결과 목록에 노출할 최대 건수 — 전역 searchMessages() 의 기본 limit(50)과 동일하게 맞춘다.
const DM_SEARCH_RESULT_LIMIT = 50

// peerId2(상대)의 공개키로 공유 비밀키를 1회 도출 — get-dm-history / search-dm-messages 는
// 같은 상대와의 메시지 여러 건을 순회하므로, 호출부에서 루프 진입 전 한 번만 계산해
// decryptDMRecord 에 인자로 넘긴다(메시지마다 동일 키를 반복 도출하지 않도록). 공개키가
// 없거나 도출에 실패하면 null 을 반환해 decryptDMRecord 가 평문 fallback 경로를 타게 한다.
function deriveSharedSecretForPeer(ctx, peerId2) {
  const otherPublicKey = ctx.state.peerPublicKeyMap.get(peerId2)
  if (!otherPublicKey) return null
  try {
    return deriveSharedSecret(ctx.state.myPrivateKey, otherPublicKey)
  } catch (err) {
    console.warn(`[히스토리] sharedSecret 도출 실패: peerId=${peerId2}`, err.message)
    return null
  }
}

// DM 메시지 레코드 하나를 복호화 — get-dm-history / search-dm-messages 공용 로직.
// peerId1 = 나, peerId2 = 상대방. sharedSecret 은 호출부에서 미리 도출해 전달한다(루프 밖 1회 도출).
// encrypted_payload 가 없거나 sharedSecret 이 없으면(레거시 평문 DM 또는 키 교환 이전
// 오프라인 캐시, 혹은 공유키 도출 실패) 원본 그대로 반환한다.
function decryptDMRecord(ctx, msg, peerId1, peerId2, sharedSecret) {
  const readFlag = !!msg.read

  if (msg.encrypted_payload && sharedSecret) {
    try {
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
        // 답장(#28) — 평문 컬럼(reply_to_id/reply_preview)이 우선이지만, 키 교환 이전에
        // 암호문만 저장된 행은 컬럼이 비어있으므로 복호화 페이로드에서 복원한다.
        reply_to_id: msg.reply_to_id || decryptedPayload.replyToId || null,
        reply_preview: msg.reply_preview
          || (decryptedPayload.replyPreview ? JSON.stringify(decryptedPayload.replyPreview) : null),
        // @멘션(#29) — reply 와 동일한 우선순위 규칙(평문 컬럼 우선, 없으면 복호화 페이로드에서 복원).
        mentions: msg.mentions
          || (Array.isArray(decryptedPayload.mentions) && decryptedPayload.mentions.length > 0
            ? JSON.stringify(decryptedPayload.mentions) : null),
      }
    } catch (err) {
      console.warn(`[히스토리] 복호화 처리 실패: msgId=${msg.id}`, err.message)
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
    // 상대(peerId2)가 고정이므로 공유키는 루프 밖에서 1회만 도출해 재사용한다.
    const sharedSecret = deriveSharedSecretForPeer(ctx, peerId2)
    return history.map(msg => decryptDMRecord(ctx, msg, peerId1, peerId2, sharedSecret))
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
    // 상대(peerId)가 고정이므로 공유키는 루프 밖에서 1회만 도출해 재사용한다.
    const sharedSecret = deriveSharedSecretForPeer(ctx, peerId)

    const results = []
    for (const record of records) {
      const decrypted = decryptDMRecord(ctx, record, myPeerId, peerId, sharedSecret)
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

  // 검색 결과 점프(#36) — 아직 화면에 로드되지 않은 과거 결과를 클릭했을 때, 해당 타임스탬프
  // 보다 최신인 메시지 개수(rank)를 반환한다. 렌더러는 (rank + 1)을 limit 으로 삼아 히스토리를
  // 한 번에 불러와 대상 메시지를 포함시킨다.
  ipcMain.handle('get-global-message-rank', (_, { timestamp }) => getGlobalMessageRank(ctx.state.database, timestamp))
  ipcMain.handle('get-dm-message-rank', (_, { peerId, timestamp }) =>
    getDMMessageRank(ctx.state.database, ctx.state.peerId, peerId, timestamp))
}

module.exports = { registerHistoryHandlers }
