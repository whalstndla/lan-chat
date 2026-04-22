// src/components/MarkdownRenderer.jsx
import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'

// 접힘 기준 높이 (px). 이 값을 넘으면 기본 접힘 상태로 렌더하고 더보기 버튼 노출.
const COLLAPSED_MAX_HEIGHT = 200

// 긴 코드블록을 접기/펼치기로 보여주는 래퍼.
// pre 내부 높이를 측정해 임계값을 넘으면 max-height 로 자르고 하단에 페이드 + 토글 버튼을 추가.
function CollapsibleCodeBlock({ children }) {
  const preRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const preElement = preRef.current
    if (!preElement) return
    const checkOverflow = () => {
      setOverflowing(preElement.scrollHeight > COLLAPSED_MAX_HEIGHT + 16)
    }
    checkOverflow()
    // 폰트/이미지 로드 등으로 높이가 나중에 변하는 경우 대응
    const observer = new ResizeObserver(checkOverflow)
    observer.observe(preElement)
    return () => observer.disconnect()
  }, [children])

  const shouldCollapse = overflowing && !expanded
  return (
    <div className="relative my-1">
      <pre
        ref={preRef}
        style={shouldCollapse ? { maxHeight: COLLAPSED_MAX_HEIGHT } : undefined}
        className={`rounded text-[13px] font-mono [&>code.hljs]:block [&>code.hljs]:p-3 [&>code.hljs]:rounded [&>code.hljs]:whitespace-pre-wrap [&>code.hljs]:break-all ${shouldCollapse ? 'overflow-hidden' : ''}`}
      >
        {children}
      </pre>
      {shouldCollapse && (
        // 하단 페이드 — github-dark 배경(#0d1117)으로 자연스럽게 사라지게
        <div className="pointer-events-none absolute left-0 right-0 bottom-0 h-14 rounded-b bg-gradient-to-t from-[#0d1117] to-transparent" />
      )}
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="mt-1 cursor-pointer text-xs text-vsc-accent hover:underline"
        >
          {expanded ? '접기 ↑' : '더 보기 ↓'}
        </button>
      )}
    </div>
  )
}

// 마크다운 렌더링 커스텀 컴포넌트 (보안 + 스타일링)
const markdownComponents = {
  // 링크 — http/https만 허용, 외부 브라우저로 열기
  a: ({ href, children }) => {
    if (!/^https?:\/\//i.test(href || '')) return <span>{children}</span>
    return (
      <a
        href={href}
        className="text-vsc-accent underline hover:opacity-80 break-all"
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
  // 인라인 코드 — pre > code에서도 호출되므로 인라인 스타일만 적용.
  // rehype-highlight이 코드블록 code 요소에 'hljs' 클래스를 붙이는데, 이를 감지해 인라인 스타일을 건너뛴다.
  code: ({ children, className, ...props }) => {
    const isBlock = typeof className === 'string' && className.includes('hljs')
    if (isBlock) {
      return <code className={className} {...props}>{children}</code>
    }
    return (
      <code className="bg-vsc-bg text-vsc-accent px-1 py-0.5 rounded text-xs font-mono" {...props}>
        {children}
      </code>
    )
  },
  // 코드 블록 — 긴 경우 접힘 상태로 렌더하는 래퍼 컴포넌트로 대체.
  pre: ({ children }) => <CollapsibleCodeBlock>{children}</CollapsibleCodeBlock>,
  // 불릿 리스트 — list-outside + 좌측 패딩으로 래핑 시 들여쓰기 유지
  ul: ({ children }) => <ul className="list-disc list-outside pl-5 my-1 space-y-0.5">{children}</ul>,
  // 번호 리스트 — list-outside + 좌측 패딩
  ol: ({ children }) => <ol className="list-decimal list-outside pl-5 my-1 space-y-0.5">{children}</ol>,
  // 리스트 아이템 — 마커와 내용 사이 간격 약간
  li: ({ children }) => <li className="pl-1">{children}</li>,
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
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={markdownComponents}
    >
      {content || ''}
    </ReactMarkdown>
  )
}
