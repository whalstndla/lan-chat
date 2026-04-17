// 이미지 붙여넣기 확인 다이얼로그 (여러 장 누적 지원).
// MessageInput.jsx 에서 분리 (Phase 3).

import React, { useEffect } from 'react'
import { X } from 'lucide-react'

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function PastePreviewDialog({ pastePreview, isSending, onConfirm, onCancel, onRemoveItem }) {
  // Enter/Escape 단축키 처리
  useEffect(() => {
    if (!pastePreview) return
    const handleKeyDown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        onConfirm()
      } else if (event.key === 'Escape') {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pastePreview, onConfirm, onCancel])

  if (!pastePreview) return null

  return (
    <div className="absolute bottom-20 left-4 right-4 z-20 bg-vsc-panel border border-vsc-border rounded-lg p-4 shadow-lg">
      <div className="flex items-start justify-between mb-3">
        <span className="text-sm font-semibold text-vsc-text">
          이미지 전송 {pastePreview.files.length > 1 && `(${pastePreview.files.length}장)`}
        </span>
        <button onClick={onCancel} className="cursor-pointer text-vsc-muted hover:text-vsc-text" aria-label="취소">
          <X size={16} />
        </button>
      </div>
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {pastePreview.previews.map((preview, index) => (
          <div key={index} className="relative shrink-0 group/paste">
            <img
              src={preview.previewUrl}
              alt="미리보기"
              className="w-20 h-20 object-cover rounded border border-vsc-border bg-vsc-bg"
            />
            <button
              onClick={() => onRemoveItem(index)}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/paste:opacity-100 transition-opacity cursor-pointer"
              aria-label="제거"
            >
              <X size={10} />
            </button>
            <p className="text-[10px] text-vsc-muted text-center mt-0.5 truncate w-20">
              {formatFileSize(preview.fileSize)}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-vsc-muted mb-3">이미지를 더 붙여넣으면 추가됩니다</p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="cursor-pointer text-xs px-3 py-1.5 rounded bg-vsc-hover text-vsc-muted hover:text-vsc-text transition-colors"
        >
          취소 (Esc)
        </button>
        <button
          onClick={onConfirm}
          disabled={isSending}
          className="cursor-pointer text-xs px-3 py-1.5 rounded bg-vsc-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          전송 (Enter)
        </button>
      </div>
    </div>
  )
}
