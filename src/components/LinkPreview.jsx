// src/components/LinkPreview.jsx
import React from 'react'
import { findTextLinks } from '../utils/messageLinks'

// 텍스트에서 URL을 감지해서 클릭 가능한 링크로 변환
export function parseLinksInText(text) {
  const parts = []
  let offset = 0
  for (const link of findTextLinks(text)) {
    parts.push(text.slice(offset, link.index))
    parts.push(
        <a
          key={link.index}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="text-vsc-accent underline hover:opacity-80 break-all"
          onClick={(event) => {
            event.preventDefault()
            window.electronAPI.openExternal(link.url)
          }}
        >
          {link.text}
        </a>
    )
    offset = link.lastIndex
  }
  parts.push(text.slice(offset))
  return parts
}
