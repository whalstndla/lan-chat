// src/components/LinkPreview.jsx
import React from 'react'

const URL패턴 = /(https?:\/\/[^\s]+)/g

// 텍스트에서 URL을 감지해서 클릭 가능한 링크로 변환
export function 텍스트에서링크변환(텍스트) {
  const 부분들 = 텍스트.split(URL패턴)
  return 부분들.map((부분, 인덱스) => {
    if (URL패턴.test(부분)) {
      URL패턴.lastIndex = 0 // 정규식 상태 초기화
      return (
        <a
          key={인덱스}
          href={부분}
          target="_blank"
          rel="noreferrer"
          className="text-vsc-accent underline hover:opacity-80"
          onClick={(이벤트) => {
            이벤트.preventDefault()
            // Electron에서 외부 링크는 shell.openExternal로 열어야 함
            window.open(부분)
          }}
        >
          {부분}
        </a>
      )
    }
    return 부분
  })
}
