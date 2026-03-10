// src/components/Message.jsx
import React from 'react'
import { Paperclip } from 'lucide-react'
import { parseLinksInText } from './LinkPreview'
import useUserStore from '../store/useUserStore'

// timestamp → "오후 2:30" 형식
function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Message({ message }) {
  const myPeerId = useUserStore(state => state.myPeerId)
  const isMyMessage = message.fromId === myPeerId || message.from_id === myPeerId

  const sender = message.from || message.from_name
  const contentType = message.contentType || message.content_type
  const fileUrl = message.fileUrl || message.file_url
  const fileName = message.fileName || message.file_name

  return (
    <div className={`flex gap-3 px-4 py-1.5 hover:bg-vsc-hover group ${isMyMessage ? 'flex-row-reverse' : ''}`}>
      {/* 아바타 */}
      <div className="w-8 h-8 rounded bg-vsc-border flex items-center justify-center text-xs text-vsc-accent font-bold shrink-0 mt-0.5">
        {sender?.[0]?.toUpperCase() || '?'}
      </div>

      <div className={`flex flex-col max-w-[70%] ${isMyMessage ? 'items-end' : ''}`}>
        {/* 닉네임 + 시간 */}
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className={`text-xs font-semibold ${isMyMessage ? 'text-vsc-accent' : 'text-vsc-text'}`}>
            {isMyMessage ? '나' : sender}
          </span>
          <span className="text-vsc-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity">
            {formatTime(message.timestamp)}
          </span>
        </div>

        {/* 메시지 내용 */}
        {(contentType === 'text' || !contentType) && (
          <div className="bg-vsc-panel rounded px-3 py-1.5 text-sm text-vsc-text leading-relaxed">
            {parseLinksInText(message.content || '')}
          </div>
        )}

        {contentType === 'image' && fileUrl && (
          <div className="rounded overflow-hidden border border-vsc-border">
            <img
              src={fileUrl}
              alt={fileName || '이미지'}
              className="max-w-xs max-h-64 object-contain bg-vsc-bg"
              onError={(event) => { event.target.style.display = 'none' }}
            />
          </div>
        )}

        {contentType === 'video' && fileUrl && (
          <div className="rounded overflow-hidden border border-vsc-border">
            <video
              src={fileUrl}
              controls
              className="max-w-xs max-h-64"
            />
          </div>
        )}

        {contentType === 'file' && fileUrl && (
          <a
            href={fileUrl}
            download={fileName}
            className="cursor-pointer flex items-center gap-2 bg-vsc-panel rounded px-3 py-2 text-sm text-vsc-accent hover:opacity-80 border border-vsc-border transition-opacity duration-150"
          >
            <Paperclip size={14} className="shrink-0" />
            {fileName || '파일'}
          </a>
        )}
      </div>
    </div>
  )
}
