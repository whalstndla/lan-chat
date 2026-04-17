// 이미지 라이트박스 — 확대/축소/드래그/우클릭 복사 지원.
// Message.jsx 에서 분리 (Phase 3).

import React, { useState, useEffect, useRef } from 'react'
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react'

export default function ImageLightbox({ url, onClose }) {
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)
  const [contextMenu, setContextMenu] = useState(null) // { x, y }

  // Escape 키로 닫기
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function handleContainerClick() {
    onClose()
    setZoom(1)
    setPos({ x: 0, y: 0 })
    setContextMenu(null)
  }

  function handleWheel(event) {
    event.preventDefault()
    setZoom(prev => Math.min(Math.max(prev + (event.deltaY > 0 ? -0.2 : 0.2), 0.5), 5))
  }

  function handleImageClick(event) {
    event.stopPropagation()
    setContextMenu(null)
    if (dragRef.current === 'dragged') { dragRef.current = null; return }
    if (zoom === 1) {
      const rect = event.currentTarget.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const targetZoom = 2
      setZoom(targetZoom)
      setPos({
        x: (centerX - event.clientX) / targetZoom,
        y: (centerY - event.clientY) / targetZoom,
      })
    } else {
      setZoom(1)
      setPos({ x: 0, y: 0 })
    }
  }

  function handleImageContextMenu(event) {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY })
  }

  function handleMouseDown(event) {
    if (zoom <= 1) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const startPos = { ...pos }
    dragRef.current = true

    let dragged = false
    const handleMouseMove = (moveEvent) => {
      dragged = true
      const dx = (moveEvent.clientX - startX) / zoom
      const dy = (moveEvent.clientY - startY) / zoom
      setPos({ x: startPos.x + dx, y: startPos.y + dy })
    }
    const handleMouseUp = () => {
      dragRef.current = dragged ? 'dragged' : null
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  async function handleCopyImage() {
    const success = await window.electronAPI.copyImageToClipboard(url)
    setContextMenu(null)
    if (!success) console.warn('이미지 복사 실패')
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center overflow-hidden"
      onClick={handleContainerClick}
      onWheel={handleWheel}
    >
      <button
        onClick={() => { onClose(); setZoom(1); setPos({ x: 0, y: 0 }) }}
        className="absolute top-4 right-4 text-white/70 hover:text-white cursor-pointer z-10"
        aria-label="닫기"
      >
        <X size={28} />
      </button>

      {/* 확대/축소 컨트롤 */}
      <div
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 bg-black/60 rounded-full px-2 py-1"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={() => setZoom(prev => Math.max(prev - 0.25, 0.5))}
          disabled={zoom <= 0.5}
          className="p-1.5 text-white/70 hover:text-white disabled:text-white/30 cursor-pointer disabled:cursor-not-allowed"
          aria-label="축소"
        >
          <ZoomOut size={18} />
        </button>
        <span className="text-white/80 text-xs min-w-[40px] text-center select-none">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom(prev => Math.min(prev + 0.25, 5))}
          disabled={zoom >= 5}
          className="p-1.5 text-white/70 hover:text-white disabled:text-white/30 cursor-pointer disabled:cursor-not-allowed"
          aria-label="확대"
        >
          <ZoomIn size={18} />
        </button>
        {zoom !== 1 && (
          <button
            onClick={() => { setZoom(1); setPos({ x: 0, y: 0 }) }}
            className="p-1.5 text-white/70 hover:text-white cursor-pointer ml-0.5"
            aria-label="원래 크기"
          >
            <RotateCcw size={16} />
          </button>
        )}
      </div>

      <img
        src={url}
        alt="이미지 미리보기"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded select-none"
        style={{
          transform: `scale(${zoom}) translate(${pos.x}px, ${pos.y}px)`,
          cursor: zoom > 1 ? 'grab' : 'zoom-in',
          transition: dragRef.current ? 'none' : 'transform 0.1s ease',
        }}
        draggable={false}
        onClick={handleImageClick}
        onContextMenu={handleImageContextMenu}
        onMouseDown={handleMouseDown}
      />

      {/* 우클릭 컨텍스트 메뉴 — 이미지 복사 */}
      {contextMenu && (
        <div
          className="fixed z-[60] bg-vsc-panel border border-vsc-border rounded-md shadow-lg py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-1.5 text-sm text-vsc-text hover:bg-vsc-hover cursor-pointer"
            onClick={handleCopyImage}
          >
            이미지 복사
          </button>
        </div>
      )}
    </div>
  )
}
