// src/components/Sidebar.jsx
import React from 'react'
import usePeerStore from '../store/usePeerStore'
import useChatStore from '../store/useChatStore'
import useUserStore from '../store/useUserStore'

export default function Sidebar() {
  const 온라인피어목록 = usePeerStore(상태 => 상태.온라인피어목록)
  const { 현재채팅방, 현재채팅방변경 } = useChatStore()
  const 나의닉네임 = useUserStore(상태 => 상태.나의닉네임)

  const 전체채팅선택됨 = 현재채팅방.타입 === 'global'

  return (
    <div className="w-52 bg-vsc-sidebar border-r border-vsc-border flex flex-col shrink-0">
      {/* 앱 타이틀 */}
      <div className="px-4 py-3 border-b border-vsc-border">
        <h1 className="text-vsc-text font-semibold text-sm">💬 LAN Chat</h1>
        {나의닉네임 && (
          <p className="text-vsc-muted text-xs mt-0.5">{나의닉네임}</p>
        )}
      </div>

      {/* 전체 채팅 */}
      <div className="px-2 py-2">
        <p className="text-vsc-muted text-xs px-2 py-1 mb-1 uppercase tracking-wider">채팅</p>
        <button
          onClick={() => 현재채팅방변경({ 타입: 'global' })}
          className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
            전체채팅선택됨
              ? 'bg-vsc-selected text-vsc-text'
              : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
          }`}
        >
          # 전체 채팅
        </button>
      </div>

      {/* DM 목록 */}
      <div className="px-2 py-2 flex-1 overflow-y-auto">
        <p className="text-vsc-muted text-xs px-2 py-1 mb-1 uppercase tracking-wider">
          DM ({온라인피어목록.length})
        </p>
        {온라인피어목록.length === 0 ? (
          <p className="text-vsc-muted text-xs px-3 py-1">대기 중...</p>
        ) : (
          온라인피어목록.map((피어) => {
            const 선택됨 = 현재채팅방.타입 === 'dm' && 현재채팅방.상대피어아이디 === 피어.피어아이디
            return (
              <button
                key={피어.피어아이디}
                onClick={() => 현재채팅방변경({ 타입: 'dm', 상대피어아이디: 피어.피어아이디, 상대닉네임: 피어.닉네임 })}
                className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors flex items-center gap-2 ${
                  선택됨
                    ? 'bg-vsc-selected text-vsc-text'
                    : 'text-vsc-muted hover:bg-vsc-hover hover:text-vsc-text'
                }`}
              >
                <span className="text-vsc-accent text-xs">●</span>
                {피어.닉네임}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
