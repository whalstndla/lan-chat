// src/components/Message.jsx
import React from 'react'
import { 텍스트에서링크변환 } from './LinkPreview'
import useUserStore from '../store/useUserStore'

// timestamp → "오후 2:30" 형식
function 시간포맷(timestamp) {
  return new Date(timestamp).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Message({ 메시지 }) {
  const 나의피어아이디 = useUserStore(상태 => 상태.나의피어아이디)
  const 내메시지 = 메시지.fromId === 나의피어아이디 || 메시지.from_id === 나의피어아이디

  const 발신자 = 메시지.from || 메시지.from_name
  const 내용타입 = 메시지.contentType || 메시지.content_type
  const 파일URL = 메시지.fileUrl || 메시지.file_url
  const 파일이름 = 메시지.fileName || 메시지.file_name

  return (
    <div className={`flex gap-3 px-4 py-1.5 hover:bg-vsc-hover group ${내메시지 ? 'flex-row-reverse' : ''}`}>
      {/* 아바타 */}
      <div className="w-8 h-8 rounded bg-vsc-border flex items-center justify-center text-xs text-vsc-accent font-bold shrink-0 mt-0.5">
        {발신자?.[0]?.toUpperCase() || '?'}
      </div>

      <div className={`flex flex-col max-w-[70%] ${내메시지 ? 'items-end' : ''}`}>
        {/* 닉네임 + 시간 */}
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className={`text-xs font-semibold ${내메시지 ? 'text-vsc-accent' : 'text-vsc-text'}`}>
            {내메시지 ? '나' : 발신자}
          </span>
          <span className="text-vsc-muted text-xs opacity-0 group-hover:opacity-100 transition-opacity">
            {시간포맷(메시지.timestamp)}
          </span>
        </div>

        {/* 메시지 내용 */}
        {(내용타입 === 'text' || !내용타입) && (
          <div className="bg-vsc-panel rounded px-3 py-1.5 text-sm text-vsc-text leading-relaxed">
            {텍스트에서링크변환(메시지.content || '')}
          </div>
        )}

        {내용타입 === 'image' && 파일URL && (
          <div className="rounded overflow-hidden border border-vsc-border">
            <img
              src={파일URL}
              alt={파일이름 || '이미지'}
              className="max-w-xs max-h-64 object-contain bg-vsc-bg"
              onError={(이벤트) => { 이벤트.target.style.display = 'none' }}
            />
          </div>
        )}

        {내용타입 === 'video' && 파일URL && (
          <div className="rounded overflow-hidden border border-vsc-border">
            <video
              src={파일URL}
              controls
              className="max-w-xs max-h-64"
            />
          </div>
        )}

        {내용타입 === 'file' && 파일URL && (
          <a
            href={파일URL}
            download={파일이름}
            className="flex items-center gap-2 bg-vsc-panel rounded px-3 py-2 text-sm text-vsc-accent hover:opacity-80 border border-vsc-border"
          >
            📎 {파일이름 || '파일'}
          </a>
        )}
      </div>
    </div>
  )
}
