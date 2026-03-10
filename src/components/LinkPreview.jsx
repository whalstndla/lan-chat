// src/components/LinkPreview.jsx
import React from 'react'

const URL_PATTERN = /(https?:\/\/[^\s]+)/g

// 텍스트에서 URL을 감지해서 클릭 가능한 링크로 변환
export function parseLinksInText(text) {
  const parts = text.split(URL_PATTERN)
  return parts.map((part, index) => {
    if (URL_PATTERN.test(part)) {
      URL_PATTERN.lastIndex = 0 // 정규식 상태 초기화
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-vsc-accent underline hover:opacity-80"
          onClick={(event) => {
            event.preventDefault()
            // Electron에서 외부 링크는 shell.openExternal로 열어야 함
            window.open(part)
          }}
        >
          {part}
        </a>
      )
    }
    return part
  })
}
