// src/components/PatchNotes.jsx
import React, { useEffect, useState } from 'react'
import { X, Sparkles, Bug } from 'lucide-react'

const TYPE_CONFIG = {
  feat: { label: '새 기능', icon: Sparkles, color: 'text-emerald-400' },
  fix: { label: '버그 수정', icon: Bug, color: 'text-amber-400' },
}

export default function PatchNotes({ onClose, highlightVersion }) {
  const [changelog, setChangelog] = useState([])
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    window.electronAPI.getChangelog().then(setChangelog)
    window.electronAPI.getAppVersionInfo().then(info => setAppVersion(info.currentVersion))
  }, [])

  // Escape 키로 닫기
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-vsc-sidebar border border-vsc-border rounded-lg shadow-2xl w-[460px] max-h-[70vh] flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-vsc-border shrink-0">
          <div>
            <h2 className="text-sm font-bold text-vsc-text">패치노트</h2>
            {appVersion && <span className="text-xs text-vsc-muted">현재 v{appVersion}</span>}
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer p-1 rounded text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* 버전 목록 */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {changelog.map((release) => {
            const isHighlighted = highlightVersion && release.version === highlightVersion
            return (
              <div key={release.version}>
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className={`text-sm font-bold ${isHighlighted ? 'text-vsc-accent' : 'text-vsc-text'}`}>
                    v{release.version}
                  </span>
                  <span className="text-xs text-vsc-muted">{release.date}</span>
                  {isHighlighted && (
                    <span className="text-xs bg-vsc-accent/20 text-vsc-accent px-1.5 py-0.5 rounded-full font-medium">
                      NEW
                    </span>
                  )}
                </div>
                <ul className="space-y-1">
                  {release.changes.map((change, index) => {
                    const config = TYPE_CONFIG[change.type] || TYPE_CONFIG.feat
                    const Icon = config.icon
                    return (
                      <li key={index} className="flex items-start gap-2 text-xs">
                        <Icon size={12} className={`shrink-0 mt-0.5 ${config.color}`} />
                        <span className="text-vsc-text leading-relaxed">{change.text}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}

          {changelog.length === 0 && (
            <p className="text-vsc-muted text-sm text-center py-8">패치노트를 불러오는 중...</p>
          )}
        </div>
      </div>
    </div>
  )
}
