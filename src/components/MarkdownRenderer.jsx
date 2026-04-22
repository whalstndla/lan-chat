// src/components/MarkdownRenderer.jsx
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'

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
  // 코드 블록 — pre > code 구조. highlight.js 테마가 code 요소에 배경/색상을 바르므로
  // pre는 감싸는 컨테이너 역할만 하고 내부 code가 실제 스타일을 담당한다.
  pre: ({ children }) => (
    <pre className="rounded my-1 overflow-x-auto text-[13px] font-mono [&>code.hljs]:block [&>code.hljs]:p-3 [&>code.hljs]:rounded">
      {children}
    </pre>
  ),
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
