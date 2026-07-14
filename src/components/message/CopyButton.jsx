// src/components/message/CopyButton.jsx
// 복사 버튼 — 클릭 시 텍스트를 클립보드로 복사하고 잠깐 체크 아이콘으로 피드백을 보여준다.
// getText 는 클릭 시점에 복사할 텍스트를 반환하는 함수(지연 평가). 코드블록처럼 렌더 이후
// DOM 에서 실제 텍스트를 읽어야 하는 경우에 유용하다.
import React, { useEffect, useRef, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { copyToClipboard } from '../../utils/clipboard'

export default function CopyButton({ getText, className = '', size = 12, title = '복사', copiedTitle = '복사됨' }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  async function handleClick(event) {
    event.stopPropagation()
    const text = typeof getText === 'function' ? getText() : ''
    const ok = await copyToClipboard(text)
    if (!ok) return
    setCopied(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={copied ? copiedTitle : title}
      title={copied ? copiedTitle : title}
      className={className}
    >
      {copied ? <Check size={size} className="text-green-400" /> : <Copy size={size} />}
    </button>
  )
}
