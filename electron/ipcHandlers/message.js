// electron/ipcHandlers/message.js
// 메시지 전송 관련 IPC 핸들러 — 전체채팅, DM, 타이핑, 삭제, 수정

const { ipcMain } = require('electron')
const { v4: uuidv4 } = require('uuid')
const { saveMessage, editMessage } = require('../storage/queries')
const { savePendingMessage, deletePendingMessage } = require('../storage/pendingMessages')
const { deriveSharedSecret, encryptDM } = require('../crypto/encryption')
const { sendPeerMessage, broadcastPeerMessage, getCurrentNicknameSafely, cacheOwnFile, deleteMessageAndCachedFile } = require('../utils/appUtils')

// 허용 contentType/format 화이트리스트
const ALLOWED_CONTENT_TYPES = ['text', 'image', 'video', 'file']
const ALLOWED_FORMATS = [null, undefined, 'markdown']
const MAX_CONTENT_LENGTH = 10000
// 답장(#28) reply 메타 크기 상한 — 비정규화 스냅샷이 비대해지지 않도록 방어적으로 자른다.
const MAX_REPLY_SNIPPET_LENGTH = 200
const MAX_REPLY_FROMNAME_LENGTH = 100
// @멘션(#29) — 메시지 하나에 실을 수 있는 최대 멘션 수. 비정상적으로 큰 배열이 실려와도
// DB/와이어 페이로드가 비대해지지 않도록 방어적으로 자른다.
const MAX_MENTIONS_COUNT = 50

// 답장 메타 정규화/방어적 검증 — renderer/wire 어느 쪽 입력이든 { fromName, snippet } 만
// 문자열로 남기고 길이를 제한한다. replyToId 가 없으면 전부 null(=일반 메시지).
// 반환: { replyToId, replyPreview(객체|null, 라이브/와이어용), replyPreviewJson(문자열|null, DB용) }
function normalizeReply(replyToId, replyPreview) {
  if (!replyToId || typeof replyToId !== 'string') {
    return { replyToId: null, replyPreview: null, replyPreviewJson: null }
  }
  let sanitizedPreview = null
  if (replyPreview && typeof replyPreview === 'object') {
    const fromName = typeof replyPreview.fromName === 'string'
      ? replyPreview.fromName.slice(0, MAX_REPLY_FROMNAME_LENGTH) : ''
    const snippet = typeof replyPreview.snippet === 'string'
      ? replyPreview.snippet.slice(0, MAX_REPLY_SNIPPET_LENGTH) : ''
    sanitizedPreview = { fromName, snippet }
  }
  return {
    replyToId,
    replyPreview: sanitizedPreview,
    replyPreviewJson: sanitizedPreview ? JSON.stringify(sanitizedPreview) : null,
  }
}

// @멘션(#29) 정규화/방어적 검증 — 렌더러가 usePeerStore 의 닉네임 목록으로 이미 파싱해 넘긴
// peerId 배열을 문자열만 남기고 중복 제거 + 개수 상한을 적용해 정리한다. 실시간 자동완성/드롭다운은
// 만들지 않고(IME 조합 충돌 위험), 전송 시점에 렌더러가 parseMentions() 로 계산한 결과만 받는다.
// 반환: { mentions(배열, 와이어/라이브용), mentionsJson(문자열|null, DB 저장용) }
function normalizeMentions(mentions) {
  if (!Array.isArray(mentions)) return { mentions: [], mentionsJson: null }
  const deduped = [...new Set(mentions.filter(peerId => typeof peerId === 'string' && peerId.trim()))]
  const normalized = deduped.slice(0, MAX_MENTIONS_COUNT)
  return {
    mentions: normalized,
    mentionsJson: normalized.length > 0 ? JSON.stringify(normalized) : null,
  }
}

function registerMessageHandlers(ctx) {
  // 전체채팅 메시지 전송
  ipcMain.handle('send-global-message', (_, { content, contentType, fileUrl, fileName, format, replyToId, replyPreview, mentions }) => {
    // 입력 검증 — 실패 시 null 대신 { ok:false, error } 를 반환한다.
    // 과거에는 null 을 그대로 반환해 렌더러가 null.fromId 등에 접근하며 TypeError 로
    // 화이트스크린이 발생했다 (렌더러 측 null 체크는 MessageInput.jsx 에서 별도 처리).
    if (content && content.length > MAX_CONTENT_LENGTH) return { ok: false, error: 'contentTooLong' }
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) return { ok: false, error: 'invalidContentType' }
    if (!ALLOWED_FORMATS.includes(format)) format = null
    // 답장(#28) — additive. 전체채팅은 비암호화라 reply 메타를 평문 와이어 필드로 전달한다.
    const normalizedReply = normalizeReply(replyToId, replyPreview)
    // @멘션(#29) — additive. 전체채팅은 비암호화라 mentions 도 reply 와 동일하게 평문 와이어
    // 필드로 전달한다(어차피 전체채팅 메시지 본문 자체가 평문이므로 추가 노출 없음).
    const normalizedMentions = normalizeMentions(mentions)
    const currentNickname = getCurrentNicknameSafely(ctx)
    const message = {
      id: uuidv4(),
      type: 'message',
      from: currentNickname,
      fromId: ctx.state.peerId,
      to: null,
      content: content || null,
      contentType,
      format: format || null,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      timestamp: Date.now(),
      replyToId: normalizedReply.replyToId,
      replyPreview: normalizedReply.replyPreview,
      mentions: normalizedMentions.mentions,
    }
    broadcastPeerMessage(ctx, message)
    // 메시지 전송 완료 시점에 typing-stop 을 브로드캐스트 — 수신측에 최대 3초간
    // 남아있던 "입력 중" 유령 표시를 즉시 지운다.
    broadcastPeerMessage(ctx, { type: 'typing-stop', fromId: ctx.state.peerId, to: null, timestamp: Date.now() })
    // 내 메시지도 로컬 저장 — 저장 실패 시에도 메시지 반환은 계속
    try {
      saveMessage(ctx.state.database, {
        id: message.id, type: message.type,
        from_id: message.fromId, from_name: message.from,
        to_id: null, content: message.content,
        content_type: message.contentType, format: message.format,
        encrypted_payload: null,
        file_url: message.fileUrl, file_name: message.fileName,
        timestamp: message.timestamp,
        reply_to_id: normalizedReply.replyToId,
        reply_preview: normalizedReply.replyPreviewJson,
        mentions: normalizedMentions.mentionsJson,
      })
    } catch { /* DB 저장 실패 시 무시 */ }
    // 자기가 보낸 파일을 영구 캐시로 복사 (재시작 / 임시폴더 정리 후에도 표시 유지)
    if (message.fileUrl && message.fileName) {
      const ownFileName = message.fileUrl.split('/files/')[1]
      if (ownFileName) cacheOwnFile(ctx, message.id, ownFileName)
    }
    return message
  })

  // DM 전송 (E2E 암호화, 오프라인이면 pending 큐에 저장)
  ipcMain.handle('send-dm', (_, { recipientPeerId, content, contentType, fileUrl, fileName, format, replyToId, replyPreview, mentions }) => {
    // 입력 검증 — 실패 시 null 대신 { ok:false, error } 를 반환한다 (send-global-message 와 동일 이유)
    if (content && content.length > MAX_CONTENT_LENGTH) return { ok: false, error: 'contentTooLong' }
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) return { ok: false, error: 'invalidContentType' }
    if (!ALLOWED_FORMATS.includes(format)) format = null
    // 답장(#28) — DM 은 reply 스니펫이 원본 내용을 담으므로 평문 노출을 피해 fileName 처럼
    // "암호화 페이로드 안"으로 전송하고, DB 에는 file_url/file_name 처럼 평문 컬럼으로 저장한다.
    const normalizedReply = normalizeReply(replyToId, replyPreview)
    // @멘션(#29) — DM 은 "누구를 언급했는지"도 대화 내용의 일부이므로 reply 와 동일하게
    // 평문 노출을 피해 암호화 페이로드 안에 실어 보내고, 내 DB 에는 평문 컬럼으로 저장한다.
    const normalizedMentions = normalizeMentions(mentions)
    const currentNickname = getCurrentNicknameSafely(ctx)
    const messageId = uuidv4()
    const timestamp = Date.now()

    // 메시지 전송 시점에 즉시 typing-stop 신호 전송 — 상대가 연결되어 있지 않으면
    // sendPeerMessage 가 조용히 false 를 반환할 뿐이라 오프라인/pending 분기에서도 안전.
    sendPeerMessage(ctx, recipientPeerId, { type: 'typing-stop', fromId: ctx.state.peerId, to: recipientPeerId, timestamp: Date.now() })

    // 자기가 보낸 파일을 영구 캐시로 복사 — 오프라인/암호화실패/정상 모든 분기에서
    // 동일하게 적용되어야 자기 이미지가 재시작 후에도 표시됨.
    function cacheOwnFileIfAny() {
      if (!fileUrl || !fileName) return
      const ownFileName = fileUrl.split('/files/')[1]
      if (ownFileName) cacheOwnFile(ctx, messageId, ownFileName)
    }

    const recipientPublicKey = ctx.state.peerPublicKeyMap.get(recipientPeerId)
    if (!recipientPublicKey) {
      // 오프라인 — 평문으로 pending 큐에 저장
      savePendingMessage(ctx.state.database, {
        id: messageId,
        targetPeerId: recipientPeerId,
        messagePayload: { content: content || null, contentType, format: format || null, fileUrl: fileUrl || null, fileName: fileName || null, replyToId: normalizedReply.replyToId, replyPreview: normalizedReply.replyPreview, mentions: normalizedMentions.mentions },
        originalTimestamp: timestamp,
      })
      // messages 테이블에 평문으로 저장 (히스토리 표시용)
      saveMessage(ctx.state.database, {
        id: messageId, type: 'dm',
        from_id: ctx.state.peerId, from_name: currentNickname,
        to_id: recipientPeerId, content: content || null,
        content_type: contentType, format: format || null, encrypted_payload: null,
        file_url: fileUrl || null, file_name: fileName || null,
        timestamp,
        reply_to_id: normalizedReply.replyToId, reply_preview: normalizedReply.replyPreviewJson,
        mentions: normalizedMentions.mentionsJson,
      })
      cacheOwnFileIfAny()
      return {
        id: messageId, type: 'dm', from: currentNickname, fromId: ctx.state.peerId,
        to: recipientPeerId, content: content || null, contentType, format: format || null,
        fileUrl: fileUrl || null, fileName: fileName || null, timestamp, pending: true,
        replyToId: normalizedReply.replyToId, replyPreview: normalizedReply.replyPreview,
        mentions: normalizedMentions.mentions,
      }
    }

    let encryptedPayload
    try {
      const sharedSecret = deriveSharedSecret(ctx.state.myPrivateKey, recipientPublicKey)
      // ctx.state.peerId = 나(송신자), recipientPeerId = 수신자
      // 답장 메타(replyToId/replyPreview)와 mentions 도 페이로드에 함께 암호화 — 평문 와이어 노출 방지.
      encryptedPayload = encryptDM(
        { content: content || null, contentType, fileUrl: fileUrl || null, fileName: fileName || null, replyToId: normalizedReply.replyToId, replyPreview: normalizedReply.replyPreview, mentions: normalizedMentions.mentions },
        sharedSecret,
        ctx.state.peerId,
        recipientPeerId
      )
    } catch {
      // 암호화 실패 시 pending 큐에 저장 후 반환
      savePendingMessage(ctx.state.database, {
        id: messageId,
        targetPeerId: recipientPeerId,
        messagePayload: { content: content || null, contentType, format: format || null, fileUrl: fileUrl || null, fileName: fileName || null, replyToId: normalizedReply.replyToId, replyPreview: normalizedReply.replyPreview, mentions: normalizedMentions.mentions },
        originalTimestamp: timestamp,
      })
      saveMessage(ctx.state.database, {
        id: messageId, type: 'dm',
        from_id: ctx.state.peerId, from_name: currentNickname,
        to_id: recipientPeerId, content: content || null,
        content_type: contentType, format: format || null, encrypted_payload: null,
        file_url: fileUrl || null, file_name: fileName || null,
        timestamp,
        reply_to_id: normalizedReply.replyToId, reply_preview: normalizedReply.replyPreviewJson,
        mentions: normalizedMentions.mentionsJson,
      })
      cacheOwnFileIfAny()
      return {
        id: messageId, type: 'dm', from: currentNickname, fromId: ctx.state.peerId,
        to: recipientPeerId, content: content || null, contentType, format: format || null,
        fileUrl: fileUrl || null, fileName: fileName || null, timestamp, pending: true,
        replyToId: normalizedReply.replyToId, replyPreview: normalizedReply.replyPreview,
        mentions: normalizedMentions.mentions,
      }
    }

    const message = {
      id: messageId, type: 'dm', from: currentNickname, fromId: ctx.state.peerId,
      to: recipientPeerId, content: null, contentType, format: format || null, encryptedPayload,
      fileUrl: null, fileName: null, timestamp,
    }

    const sent = sendPeerMessage(ctx, recipientPeerId, message)
    // 답장 메타/mentions 는 encryptedPayload 안에만 실어 전송하고, 내 DB 에는 평문 컬럼으로 저장한다.

    if (!sent) {
      // 소켓은 있지만 연결 끊긴 경우 → pending 저장
      savePendingMessage(ctx.state.database, {
        id: messageId,
        targetPeerId: recipientPeerId,
        messagePayload: { content: content || null, contentType, format: format || null, fileUrl: fileUrl || null, fileName: fileName || null, replyToId: normalizedReply.replyToId, replyPreview: normalizedReply.replyPreview, mentions: normalizedMentions.mentions },
        originalTimestamp: timestamp,
      })
    }

    // 내 DB에는 암호문 저장
    try {
      saveMessage(ctx.state.database, {
        id: message.id, type: message.type,
        from_id: message.fromId, from_name: message.from,
        to_id: message.to, content: null,
        content_type: contentType, format: format || null, encrypted_payload: encryptedPayload,
        file_url: fileUrl || null, file_name: fileName || null,
        timestamp: message.timestamp,
        reply_to_id: normalizedReply.replyToId, reply_preview: normalizedReply.replyPreviewJson,
        mentions: normalizedMentions.mentionsJson,
      })
    } catch { /* DB 저장 실패 시 무시 */ }

    cacheOwnFileIfAny()

    // 렌더러에는 복호화된 내용으로 반환 (답장 메타/mentions 는 평문 값으로 함께 반환해 즉시 렌더)
    return {
      ...message, content: content || null, format: format || null, fileUrl: fileUrl || null, fileName: fileName || null,
      replyToId: normalizedReply.replyToId, replyPreview: normalizedReply.replyPreview,
      mentions: normalizedMentions.mentions,
      ...(sent ? {} : { pending: true }),
    }
  })

  // 타이핑 인디케이터 전송
  ipcMain.handle('send-typing', (_, targetPeerId) => {
    const currentNickname = getCurrentNicknameSafely(ctx)
    const typingMessage = {
      type: 'typing',
      fromId: ctx.state.peerId,
      from: currentNickname,
      to: targetPeerId || null,
      timestamp: Date.now(),
    }
    if (targetPeerId) {
      sendPeerMessage(ctx, targetPeerId, typingMessage)
    } else {
      broadcastPeerMessage(ctx, typingMessage)
    }
  })

  // 메시지 삭제 (본인 메시지만)
  ipcMain.handle('delete-message', (_, { messageId, targetPeerId }) => {
    deleteMessageAndCachedFile(ctx, messageId, ctx.state.peerId)
    // 상대가 오프라인이라 아직 배달되지 않은 pending 큐에도 같은 id로 남아있을 수 있다.
    // 여기서 지우지 않으면 messages 테이블에서만 삭제된 채, 상대가 재접속했을 때
    // pending 큐의 메시지가 그대로 배달되어 "삭제한 메시지가 나중에 도착"하게 된다.
    try { deletePendingMessage(ctx.state.database, messageId) } catch { /* 무시 */ }
    const currentNickname = getCurrentNicknameSafely(ctx)
    const deletePayload = {
      type: 'delete-message',
      messageId,
      fromId: ctx.state.peerId,
      from: currentNickname,
      to: targetPeerId || null,
      timestamp: Date.now(),
    }
    if (targetPeerId) {
      sendPeerMessage(ctx, targetPeerId, deletePayload)
    } else {
      broadcastPeerMessage(ctx, deletePayload)
    }
  })

  // 메시지 수정 — 본인 메시지만 수정 가능, 내용 길이 검증 후 브로드캐스트
  ipcMain.handle('edit-message', (_, { messageId, newContent, targetPeerId }) => {
    if (!newContent?.trim() || newContent.length > MAX_CONTENT_LENGTH) return null
    const editedAt = Date.now()
    editMessage(ctx.state.database, { messageId, fromId: ctx.state.peerId, newContent })
    const currentNickname = getCurrentNicknameSafely(ctx)
    const editPayload = {
      type: 'edit-message', messageId, fromId: ctx.state.peerId, from: currentNickname,
      newContent, editedAt, to: targetPeerId || null, timestamp: Date.now(),
    }
    if (targetPeerId) sendPeerMessage(ctx, targetPeerId, editPayload)
    else broadcastPeerMessage(ctx, editPayload)
    return { editedAt }
  })
}

module.exports = { registerMessageHandlers }
