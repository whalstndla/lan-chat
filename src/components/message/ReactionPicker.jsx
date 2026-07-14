// src/components/message/ReactionPicker.jsx
// 메시지 리액션 추가 버튼(#38) — 퀵 이모지 6종 + "더보기" 로 emoji-picker-react 전체 피커를
// 열어 임의 이모지로 리액션할 수 있게 한다. MessageInput.jsx 의 lazy import 패턴을 그대로 재사용해
// 번들에는 영향 없음(최초로 열 때만 로드).
import React, { Suspense, lazy, useState } from 'react'
import { SmilePlus, MoreHorizontal } from 'lucide-react'

const EmojiPicker = lazy(() => import('emoji-picker-react'))

const quickEmojis = ['👍', '❤️', '😂', '🎉', '😮', '😢']

export default function ReactionPicker({ onSelect, alignRight = false }) {
  const [showFullPicker, setShowFullPicker] = useState(false)

  function handleQuickSelect(emoji) {
    setShowFullPicker(false)
    onSelect(emoji)
  }

  function handleFullPickerSelect(emojiData) {
    setShowFullPicker(false)
    onSelect(emojiData.emoji)
  }

  return (
    <div
      className="relative group/reaction"
      // 전체 피커를 열어둔 채 popover 밖으로 나가면 다음에 다시 열 때는 퀵 이모지부터 보이도록 초기화
      onMouseLeave={() => setShowFullPicker(false)}
    >
      <button className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity p-0.5 rounded text-vsc-muted hover:text-vsc-accent cursor-pointer" aria-label="리액션 추가">
        <SmilePlus size={14} />
      </button>
      <div className={`hidden group-hover/reaction:flex absolute bottom-full pb-2 z-10 flex-col gap-1 ${alignRight ? 'right-0 items-end' : 'left-0 items-start'}`}>
        <div className="flex bg-vsc-sidebar border border-vsc-border rounded-lg shadow-lg p-1 gap-0.5">
          {quickEmojis.map(emoji => (
            <button key={emoji} onClick={() => handleQuickSelect(emoji)} className="p-1 hover:bg-vsc-hover rounded cursor-pointer text-sm">
              {emoji}
            </button>
          ))}
          <button
            onClick={() => setShowFullPicker(prev => !prev)}
            title="더 많은 이모지"
            aria-label="더 많은 이모지"
            className={`p-1 rounded cursor-pointer text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover ${showFullPicker ? 'bg-vsc-hover text-vsc-accent' : ''}`}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
        {showFullPicker && (
          <Suspense fallback={null}>
            <EmojiPicker onEmojiClick={handleFullPickerSelect} theme="dark" height={380} searchPlaceholder="이모지 검색..." />
          </Suspense>
        )}
      </div>
    </div>
  )
}
