// src/components/KeyChangeWarningModal.jsx
// TOFU 키 변경 경고 모달(#59) — 상대 공개키가 고정 키와 달라졌을 때 눈에 띄게 경고한다.
// "재설치했거나 공격일 수 있음"을 안내하고, 대면 지문(안전 번호) 비교 후 사용자가
// 명시적으로 신뢰(trust-peer-key)해야만 새 키로 교체된다. 신뢰 전까지 해당 피어와의
// 암호화 통신은 보류되어 DM 복호화가 실패할 수 있다.

import React, { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import usePeerStore from '../store/usePeerStore'

export default function KeyChangeWarningModal() {
  const keyChangedPeers = usePeerStore(state => state.keyChangedPeers)
  // 신뢰 처리 중인 peerId (중복 클릭 방지)
  const [trustingPeerId, setTrustingPeerId] = useState(null)

  const entries = Object.entries(keyChangedPeers)
  if (entries.length === 0) return null

  // 한 번에 하나씩 처리 — 가장 먼저 감지된 항목을 우선 표시한다.
  const [peerId, info] = entries[0]

  const handleTrust = async () => {
    if (trustingPeerId) return
    setTrustingPeerId(peerId)
    try {
      const result = await window.electronAPI.trustPeerKey(peerId)
      // 성공/실패 무관하게 이 경고는 닫는다(성공: 교체 완료, 실패: 보류 없음 = 이미 정리됨).
      usePeerStore.getState().clearKeyChanged(peerId)
      return result
    } finally {
      setTrustingPeerId(null)
    }
  }

  const handleDismiss = () => {
    // 지금은 신뢰하지 않고 경고만 닫는다 — 고정 키/세션 맵은 그대로 유지(보류 지속).
    // 상대가 다시 hello 를 보내면 경고가 재등장한다.
    usePeerStore.getState().clearKeyChanged(peerId)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[420px] max-w-[90vw] bg-vsc-sidebar border border-vsc-border rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-vsc-border bg-red-500/10">
          <ShieldAlert size={18} className="text-red-400 shrink-0" />
          <span className="text-sm font-semibold text-vsc-text">상대 보안키가 변경되었습니다</span>
        </div>

        <div className="px-4 py-3 space-y-3 text-sm text-vsc-text">
          <p>
            <span className="font-semibold">{info.nickname || '알 수 없음'}</span> 님의 보안키가
            이전에 신뢰한 키와 다릅니다. 상대가 앱을 재설치했을 수도 있지만,
            같은 네트워크의 누군가가 사칭을 시도하는 것일 수도 있습니다.
          </p>
          <p className="text-vsc-muted text-xs">
            신뢰하기 전까지 이 상대와의 암호화 메시지는 보류되어 열리지 않을 수 있습니다.
            안전하게 확인하려면 아래 지문을 상대에게 직접(대면/전화) 물어 일치하는지 비교하세요.
          </p>
          {info.fingerprint && (
            <div className="bg-vsc-bg border border-vsc-border rounded px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-vsc-muted mb-1">새 키 지문</p>
              <code className="text-xs text-vsc-accent break-all font-mono select-text">{info.fingerprint}</code>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-vsc-border">
          <button
            onClick={handleDismiss}
            className="cursor-pointer text-xs px-3 py-1.5 rounded bg-vsc-border hover:bg-vsc-hover text-vsc-muted hover:text-vsc-text transition-colors"
          >
            나중에
          </button>
          <button
            onClick={handleTrust}
            disabled={trustingPeerId === peerId}
            className="cursor-pointer text-xs px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {trustingPeerId === peerId ? '처리 중...' : '이 키를 신뢰'}
          </button>
        </div>
      </div>
    </div>
  )
}
