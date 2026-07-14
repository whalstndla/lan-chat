// 채팅방 검색 바 — 검색 input + 결과 드롭다운.
// ChatWindow.jsx 에서 분리 (Phase 3).
// Phase 3A(#37): 입력 300ms 디바운스, 검색어 하이라이트, 키보드 네비게이션(↑/↓/Enter/Esc) 추가.

import React, { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { highlightText } from '../../utils/highlightText'

const SEARCH_DEBOUNCE_MS = 300

export default function ChatSearchBar({
  searchResults,
  isSearching,
  onSearch,
  onResultClick,
  onClose,
}) {
  // 입력값은 로컬 상태로 즉시 반영해 타이핑 반응성을 유지하고, 실제 IPC 검색 요청(onSearch)만
  // 디바운스한다 — 키 입력마다 즉시 FTS 쿼리를 던지던 문제(#37) 수정.
  const [inputValue, setInputValue] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const debounceTimerRef = useRef(null)

  useEffect(() => () => clearTimeout(debounceTimerRef.current), [])

  // 새 검색 결과가 도착하면 선택 인덱스를 첫 번째 결과로 초기화 (없으면 -1)
  useEffect(() => {
    setSelectedIndex(searchResults.length > 0 ? 0 : -1)
  }, [searchResults])

  function handleChange(event) {
    const nextValue = event.target.value
    setInputValue(nextValue)
    clearTimeout(debounceTimerRef.current)
    if (!nextValue.trim()) {
      // 빈 입력은 디바운스 없이 즉시 결과를 초기화
      onSearch('')
      return
    }
    debounceTimerRef.current = setTimeout(() => onSearch(nextValue), SEARCH_DEBOUNCE_MS)
  }

  function handleClear() {
    clearTimeout(debounceTimerRef.current)
    setInputValue('')
    onSearch('')
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose?.()
      return
    }
    if (searchResults.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % searchResults.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + searchResults.length) % searchResults.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = searchResults[selectedIndex] ?? searchResults[0]
      if (target) onResultClick(target)
    }
  }

  return (
    <div className="px-3 pb-2.5">
      <div className="flex items-center gap-2 bg-vsc-bg border border-vsc-border rounded px-2 py-1.5">
        <Search size={13} className="text-vsc-muted shrink-0" />
        <input
          type="text"
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="메시지 검색..."
          className="flex-1 bg-transparent text-xs text-vsc-text placeholder:text-vsc-muted outline-none"
          autoFocus
        />
        {isSearching ? (
          <span className="text-xs text-vsc-muted shrink-0">검색 중...</span>
        ) : inputValue.trim() ? (
          <span className="text-xs text-vsc-muted shrink-0">{searchResults.length}건</span>
        ) : null}
        {inputValue && (
          <button
            onClick={handleClear}
            className="text-vsc-muted hover:text-vsc-text shrink-0 cursor-pointer"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {searchResults.length > 0 && (
        <div className="mt-1.5 max-h-48 overflow-y-auto rounded border border-vsc-border bg-vsc-sidebar">
          {searchResults.map((result, index) => (
            <div
              key={result.id}
              className={`px-3 py-2 hover:bg-vsc-hover border-b border-vsc-border last:border-b-0 cursor-pointer ${
                index === selectedIndex ? 'bg-vsc-hover' : ''
              }`}
              onClick={() => onResultClick(result)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="flex items-baseline gap-2 mb-0.5">
                <span className="text-xs font-semibold text-vsc-text">
                  {result.from_name || result.from || '알 수 없음'}
                </span>
                <span className="text-xs text-vsc-muted">
                  {new Date(result.timestamp).toLocaleString('ko-KR', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </div>
              <p className="text-xs text-vsc-muted line-clamp-2 break-words">
                {result.content
                  ? highlightText(result.content, inputValue)
                  : result.file_name
                    ? <>📎 {highlightText(result.file_name, inputValue)}</>
                    : null}
              </p>
            </div>
          ))}
        </div>
      )}

      {!isSearching && inputValue.trim() && searchResults.length === 0 && (
        <p className="mt-1.5 text-xs text-vsc-muted text-center py-2">검색 결과가 없습니다.</p>
      )}
    </div>
  )
}
