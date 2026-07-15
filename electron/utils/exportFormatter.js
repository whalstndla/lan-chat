// electron/utils/exportFormatter.js
// 채팅 내보내기(#74) 포맷팅 순수 로직 — Electron 런타임 의존성 없음(단위 테스트 용이성을 위해 분리).
// 입력 메시지 객체는 DB 원본 컬럼(snake_case: content_type/file_name/edited_at 등)과
// history.js 의 decryptDMRecord 가 덧붙이는 camelCase 필드(contentType/fileName 등)가
// 섞여 있을 수 있으므로, 두 표기 모두 폴백으로 처리한다.

// 타임스탬프(ms) 를 "YYYY-MM-DD HH:mm:ss" 로 포맷 — 로컬 타임존 기준
function formatTimestamp(timestampMs) {
  const date = new Date(timestampMs)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// 메시지 한 건을 사람이 읽기 좋은 한 줄로 포맷 — "시각 발신자: 내용".
// 파일/이미지 메시지처럼 content 가 없는 경우 파일명으로 대체 표시하고, 수정된 메시지는 표시를 남긴다.
function formatMessageLine(message) {
  const time = formatTimestamp(message.timestamp)
  const sender = message.from_name || message.fromName || '알 수 없음'
  const fileName = message.file_name || message.fileName
  const body = message.content || (fileName ? `[파일: ${fileName}]` : '[내용 없음]')
  const editedSuffix = (message.edited_at || message.editedAt) ? ' (수정됨)' : ''
  return `${time} ${sender}: ${body}${editedSuffix}`
}

// 메시지 배열을 txt 형식 본문으로 변환 (줄바꿈으로 join)
function formatMessagesAsText(messages) {
  return messages.map(formatMessageLine).join('\n')
}

// 메시지 한 건을 json 내보내기용 구조화 객체로 변환 — 내부 DB 컬럼명 대신 일관된 camelCase 필드만 노출.
function formatMessageForJson(message) {
  return {
    id: message.id,
    timestamp: message.timestamp,
    time: formatTimestamp(message.timestamp),
    from: message.from_name || message.fromName || null,
    fromId: message.from_id || message.fromId || null,
    content: message.content ?? null,
    contentType: message.content_type || message.contentType || 'text',
    fileName: message.file_name || message.fileName || null,
    edited: !!(message.edited_at || message.editedAt),
  }
}

module.exports = { formatTimestamp, formatMessageLine, formatMessagesAsText, formatMessageForJson }
