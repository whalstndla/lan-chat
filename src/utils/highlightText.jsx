// src/utils/highlightText.jsx
// 검색어와 일치하는 부분을 <mark> 로 감싸 반환하는 하이라이트 유틸 (Phase 3A, #37).
// 검색 결과 목록과 메시지 본문에서 공용으로 사용한다.

import React from 'react'

// 검색어를 정규식 리터럴로 안전하게 이스케이프 — 사용자가 입력한 특수문자(., *, ( 등)가
// 정규식 메타문자로 해석되어 예외가 발생하거나 의도치 않은 매칭이 되는 것을 방지한다.
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// text 안에서 query 와 대소문자 구분 없이 일치하는 부분을 <mark> 로 감싼 React 노드 배열을 반환.
// query 가 비어있거나 text 가 문자열이 아니면 원본 text 를 그대로 반환한다.
export function highlightText(text, query) {
  const trimmedQuery = query?.trim()
  if (!trimmedQuery || typeof text !== 'string' || !text) return text

  const pattern = new RegExp(`(${escapeRegExp(trimmedQuery)})`, 'gi')
  const parts = text.split(pattern)
  if (parts.length <= 1) return text

  // String.split 에 캡처 그룹이 있는 정규식을 넘기면 매칭된 부분이 홀수 인덱스에 끼워진다.
  return parts.map((part, index) =>
    index % 2 === 1
      ? <mark key={index} className="bg-yellow-400/70 text-black rounded-sm px-0.5">{part}</mark>
      : part
  )
}
