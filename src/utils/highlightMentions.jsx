// src/utils/highlightMentions.jsx
// 메시지 본문 중 "@닉네임"(멘션 매칭) 부분을 accent 배지로 감싸 반환하는 렌더링 유틸(#29).
// highlightText.jsx(검색어 하이라이트)와 동일한 split 기반 패턴 — 검색어 대신 멘션된
// 닉네임 목록을 강조 대상으로 삼는다.

import React from 'react'

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// text 안에서 "@" + mentionedNicknames 중 하나와 일치하는 부분을 accent 배지로 감싼
// React 노드 배열을 반환한다. mentionedNicknames 가 비어있거나 text 가 문자열이 아니면
// 원본 text 를 그대로 반환한다(하이라이트 스킵 — 대다수 메시지엔 멘션이 없으므로 렌더 비용 최소화).
export function highlightMentions(text, mentionedNicknames) {
  if (!mentionedNicknames?.length || typeof text !== 'string' || !text) return text

  // 긴 닉네임부터 매칭해, 짧은 닉네임이 긴 닉네임의 부분 문자열인 경우의 오매칭을 방지한다
  // (parseMentions 의 최장일치 우선 규칙과 동일한 이유).
  const sortedNicknames = [...new Set(mentionedNicknames.filter(Boolean))].sort((a, b) => b.length - a.length)
  if (sortedNicknames.length === 0) return text

  const pattern = new RegExp(`(@(?:${sortedNicknames.map(escapeRegExp).join('|')}))`, 'g')
  const parts = text.split(pattern)
  if (parts.length <= 1) return text

  // String.split 에 캡처 그룹이 있는 정규식을 넘기면 매칭된 부분이 홀수 인덱스에 끼워진다.
  return parts.map((part, index) =>
    index % 2 === 1
      ? <span key={index} className="text-vsc-accent font-semibold bg-vsc-accent/10 rounded px-1">{part}</span>
      : part
  )
}
