// src/components/MarkdownRenderer.jsx
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

// 마크다운 렌더링 커스텀 컴포넌트 (보안 + 스타일링)
const markdownComponents = {
  // 링크 — http/https만 허용, 외부 브라우저로 열기
  a: ({ href, children }) => {
    if (!/^https?:\/\//i.test(href || '')) return <span>{children}</span>
    return (
      <a
        href={href}
        className="text-vsc-accent underline hover:opacity-80"
        onClick={(event) => {
          event.preventDefault()
          window.electronAPI.openExternal(href)
        }}
      >
        {children}
      </a>
    )
  },
  // 이미지 — 마크다운 내 이미지 비활성화 (파일 첨부로만 전송)
  img: () => null,
  // 인라인 코드
  code: ({ inline, children, ...props }) => {
    if (inline) {
      return (
        <code className="bg-vsc-bg text-vsc-accent px-1 py-0.5 rounded text-xs font-mono" {...props}>
          {children}
        </code>
      )
    }
    // 코드 블록
    return (
      <code className="block bg-vsc-bg rounded p-3 text-xs font-mono overflow-x-auto my-1 text-vsc-text" {...props}>
        {children}
      </code>
    )
  },
  // 코드 블록 래퍼
  pre: ({ children }) => <pre className="my-1">{children}</pre>,
  // 불릿 리스트
  ul: ({ children }) => <ul className="list-disc list-inside my-1 space-y-0.5">{children}</ul>,
  // 번호 리스트
  ol: ({ children }) => <ol className="list-decimal list-inside my-1 space-y-0.5">{children}</ol>,
  // 리스트 아이템
  li: ({ children }) => <li>{children}</li>,
  // 인용
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-vsc-accent/50 pl-2 my-1 text-vsc-muted italic">
      {children}
    </blockquote>
  ),
  // 단락 — 여백 최소화 (채팅 말풍선이라 조밀해야 함)
  p: ({ children }) => <p className="my-0.5 first:mt-0 last:mb-0">{children}</p>,
  // 굵게
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  // 기울임
  em: ({ children }) => <em className="italic">{children}</em>,
  // 취소선
  del: ({ children }) => <del className="line-through text-vsc-muted">{children}</del>,
}

export default function MarkdownRenderer({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={markdownComponents}
    >
      {content || ''}
    </ReactMarkdown>
  )
}
