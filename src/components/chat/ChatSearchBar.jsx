// 채팅방 검색 바 — 검색 input + 결과 드롭다운.
// ChatWindow.jsx 에서 분리 (Phase 3).

import React from 'react'
import { Search, X } from 'lucide-react'

export default function ChatSearchBar({
  searchQuery,
  searchResults,
  isSearching,
  onSearch,
  onResultClick,
}) {
  return (
    <div className="px-3 pb-2.5">
      <div className="flex items-center gap-2 bg-vsc-bg border border-vsc-border rounded px-2 py-1.5">
        <Search size={13} className="text-vsc-muted shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="메시지 검색..."
          className="flex-1 bg-transparent text-xs text-vsc-text placeholder:text-vsc-muted outline-none"
          autoFocus
        />
        {isSearching ? (
          <span className="text-xs text-vsc-muted shrink-0">검색 중...</span>
        ) : searchQuery.trim() ? (
          <span className="text-xs text-vsc-muted shrink-0">{searchResults.length}건</span>
        ) : null}
        {searchQuery && (
          <button
            onClick={() => onSearch('')}
            className="text-vsc-muted hover:text-vsc-text shrink-0 cursor-pointer"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {searchResults.length > 0 && (
        <div className="mt-1.5 max-h-48 overflow-y-auto rounded border border-vsc-border bg-vsc-sidebar">
          {searchResults.map((result) => (
            <div
              key={result.id}
              className="px-3 py-2 hover:bg-vsc-hover border-b border-vsc-border last:border-b-0 cursor-pointer"
              onClick={() => onResultClick(result.id)}
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
              <p className="text-xs text-vsc-muted line-clamp-2 break-words">{result.content}</p>
            </div>
          ))}
        </div>
      )}

      {!isSearching && searchQuery.trim() && searchResults.length === 0 && (
        <p className="mt-1.5 text-xs text-vsc-muted text-center py-2">검색 결과가 없습니다.</p>
      )}
    </div>
  )
}
