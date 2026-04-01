// src/components/LinkPreviewCard.jsx
// URL의 OG 메타데이터를 카드 형태로 표시하는 컴포넌트
import React, { useState, useEffect, useRef } from 'react'
import { ExternalLink } from 'lucide-react'

// URL별 캐시 — 컴포넌트 재마운트 시에도 재요청 방지
const previewCache = new Map()

export default function LinkPreviewCard({ url }) {
  const [preview, setPreview] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    // 캐시에 있으면 즉시 사용
    if (previewCache.has(url)) {
      const cached = previewCache.get(url)
      setPreview(cached)
      setLoaded(true)
      return
    }

    let cancelled = false

    async function fetchPreview() {
      try {
        const result = await window.electronAPI.fetchLinkPreview(url)
        previewCache.set(url, result)
        if (!cancelled && mountedRef.current) {
          setPreview(result)
          setLoaded(true)
        }
      } catch {
        previewCache.set(url, null)
        if (!cancelled && mountedRef.current) {
          setLoaded(true)
        }
      }
    }

    fetchPreview()

    return () => {
      cancelled = true
      mountedRef.current = false
    }
  }, [url])

  // 로딩 중이거나 데이터 없으면 아무것도 표시하지 않음 (깜빡임 방지)
  if (!loaded || !preview) return null

  // 외부 브라우저로 열기
  function handleClick(event) {
    event.preventDefault()
    window.electronAPI.openExternal(url)
  }

  // URL에서 도메인 추출
  let hostname = ''
  try {
    hostname = new URL(url).hostname
  } catch {
    hostname = url
  }

  return (
    <a
      href={url}
      onClick={handleClick}
      className="block mt-1.5 max-w-xs rounded border border-vsc-border bg-vsc-panel overflow-hidden hover:border-vsc-accent transition-colors cursor-pointer no-underline"
    >
      {/* OG 이미지 (있을 경우) */}
      {preview.image && (
        <div className="w-full h-32 bg-vsc-bg overflow-hidden">
          <img
            src={preview.image}
            alt=""
            className="w-full h-full object-cover"
            onError={(event) => { event.target.style.display = 'none' }}
          />
        </div>
      )}

      {/* 텍스트 영역 */}
      <div className="px-3 py-2">
        {/* 사이트 도메인 */}
        <div className="flex items-center gap-1 text-vsc-muted text-xs mb-0.5">
          <ExternalLink size={10} className="shrink-0" />
          <span className="truncate">{hostname}</span>
        </div>

        {/* 제목 */}
        {preview.title && (
          <div className="text-sm text-vsc-accent font-medium leading-snug line-clamp-2">
            {preview.title}
          </div>
        )}

        {/* 설명 */}
        {preview.description && (
          <div className="text-xs text-vsc-muted leading-relaxed mt-0.5 line-clamp-2">
            {preview.description}
          </div>
        )}
      </div>
    </a>
  )
}
