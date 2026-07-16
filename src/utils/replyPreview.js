// src/utils/replyPreview.js
// 답장/인용(#28)용 비정규화 미리보기 스냅샷 생성 — 순수 로직.
// 원본 메시지가 수신측에 로드 안 됐거나 삭제됐어도 인용이 견고하게 렌더되도록,
// 원본 발신자 이름 + 내용 일부(또는 첨부 표시)를 답장 메시지에 함께 저장/전송한다.

// 인용 스니펫 최대 길이 — 원본 content 앞부분만 잘라 저장한다.
export const REPLY_SNIPPET_MAX_LENGTH = 80

// 첨부 타입별 스니펫 표시 — 텍스트가 없는 이미지/동영상/파일 메시지를 인용할 때 사용.
const ATTACHMENT_SNIPPET_BY_TYPE = {
  image: '사진',
  video: '동영상',
}

// 메시지 객체 → { fromName, snippet } 스냅샷.
// 라이브(camelCase)/DB(snake_case) 양쪽 키를 모두 허용해 어느 경로의 메시지든 처리한다.
export function buildReplyPreview(message) {
  if (!message) return null
  const fromName = message.from || message.from_name || '알 수 없음'
  const contentType = message.contentType || message.content_type
  const fileName = message.fileName || message.file_name

  let snippet
  if (contentType === 'file') {
    snippet = `📎 ${fileName || '파일'}`
  } else if (ATTACHMENT_SNIPPET_BY_TYPE[contentType]) {
    snippet = ATTACHMENT_SNIPPET_BY_TYPE[contentType]
  } else {
    const content = message.content || ''
    snippet = content.length > REPLY_SNIPPET_MAX_LENGTH
      ? `${content.slice(0, REPLY_SNIPPET_MAX_LENGTH)}…`
      : content
  }

  return { fromName, snippet }
}

// 저장/전송된 reply_preview 값을 렌더용 객체로 정규화한다.
// 라이브 경로는 객체({ fromName, snippet }), DB/히스토리 경로는 JSON 문자열로 들어온다.
export function parseReplyPreview(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return null
}
