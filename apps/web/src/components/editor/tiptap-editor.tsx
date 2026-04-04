'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { useCallback, useEffect } from 'react';

import { cn } from '@/lib/utils';

const lowlight = createLowlight(common);

// -- Types --------------------------------------------------------------------

export interface TiptapEditorProps {
  content?: Record<string, unknown>;
  editable?: boolean;
  placeholder?: string;
  onChange?: (json: Record<string, unknown>) => void;
  className?: string;
  minHeight?: string;
}

// -- Editor Component ---------------------------------------------------------

export function TiptapEditor({
  content,
  editable = true,
  placeholder = 'Start writing...',
  onChange,
  className,
  minHeight = '300px',
}: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // replaced by CodeBlockLowlight
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-blue-600 underline cursor-pointer' },
      }),
      Placeholder.configure({ placeholder }),
      CodeBlockLowlight.configure({ lowlight }),
    ],
    content: content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    editable,
    onUpdate: ({ editor: ed }) => {
      onChange?.(ed.getJSON() as Record<string, unknown>);
    },
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm max-w-none focus:outline-none text-gray-800',
          'prose-headings:font-bold prose-h1:text-xl prose-h2:text-lg prose-h3:text-base',
          'prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm',
          'prose-blockquote:border-l-4 prose-blockquote:border-gray-300 prose-blockquote:pl-4 prose-blockquote:italic',
        ),
      },
    },
  });

  // Sync editable prop
  useEffect(() => {
    if (editor && editor.isEditable !== editable) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  if (!editor) return null;

  return (
    <div className={cn('rounded-md border border-gray-200 bg-white', className)}>
      {editable && <Toolbar editor={editor} />}
      <div className="p-4" style={{ minHeight }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// -- Read-Only Viewer ---------------------------------------------------------

export function TiptapViewer({
  content,
  className,
}: {
  content: Record<string, unknown>;
  className?: string;
}) {
  return (
    <TiptapEditor
      content={content}
      editable={false}
      className={className}
      minHeight="auto"
    />
  );
}

// -- Toolbar ------------------------------------------------------------------

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link')['href'] as string | undefined;
    const url = window.prompt('Enter URL', previousUrl ?? 'https://');
    if (url === null) return; // cancelled
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  return (
    <div className="flex flex-wrap gap-0.5 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
      {/* Text formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        title="Bold"
      >
        B
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        title="Italic"
      >
        <span className="italic">I</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive('underline')}
        title="Underline"
      >
        <span className="underline">U</span>
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')}
        title="Strikethrough"
      >
        <span className="line-through">S</span>
      </ToolbarButton>

      <ToolbarDivider />

      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive('heading', { level: 1 })}
        title="Heading 1"
      >
        H1
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
        title="Heading 2"
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
        title="Heading 3"
      >
        H3
      </ToolbarButton>

      <ToolbarDivider />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        title="Bullet List"
      >
        &bull; List
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        title="Ordered List"
      >
        1. List
      </ToolbarButton>

      <ToolbarDivider />

      {/* Block elements */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
        title="Blockquote"
      >
        &ldquo; Quote
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive('codeBlock')}
        title="Code Block"
      >
        {'</>'}
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal Rule"
      >
        &mdash;
      </ToolbarButton>

      <ToolbarDivider />

      {/* Link */}
      <ToolbarButton
        onClick={setLink}
        active={editor.isActive('link')}
        title="Link"
      >
        Link
      </ToolbarButton>

      <ToolbarDivider />

      {/* Undo/Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo"
      >
        Undo
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo"
      >
        Redo
      </ToolbarButton>
    </div>
  );
}

// -- Toolbar Primitives -------------------------------------------------------

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'rounded px-2 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-gray-200 text-gray-900'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="mx-1 w-px self-stretch bg-gray-200" />;
}
