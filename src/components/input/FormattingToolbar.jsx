// Tiptap 에디터용 마크다운 포맷팅 툴바.
// MessageInput.jsx 에서 분리 (Phase 3).

import React from 'react'
import { Bold, Italic, Strikethrough, Code, FileCode } from 'lucide-react'

function ToolbarButton({ icon: Icon, isActive, onClick, title }) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={title}
      className={`cursor-pointer p-1 rounded transition-colors duration-100 ${
        isActive
          ? 'text-vsc-accent bg-vsc-hover'
          : 'text-vsc-muted hover:text-vsc-text hover:bg-vsc-hover'
      }`}
    >
      <Icon size={14} />
    </button>
  )
}

export default function FormattingToolbar({ editor }) {
  if (!editor) return null
  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-vsc-border">
      <ToolbarButton
        icon={Bold}
        isActive={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="굵게 (Ctrl+B)"
      />
      <ToolbarButton
        icon={Italic}
        isActive={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="기울임 (Ctrl+I)"
      />
      <ToolbarButton
        icon={Strikethrough}
        isActive={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="취소선 (Ctrl+Shift+S)"
      />
      <ToolbarButton
        icon={Code}
        isActive={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="인라인 코드 (Ctrl+E)"
      />
      <ToolbarButton
        icon={FileCode}
        isActive={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="코드블록"
      />
    </div>
  )
}
