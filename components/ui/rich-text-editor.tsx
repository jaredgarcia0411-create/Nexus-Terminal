'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold, Italic, Underline, Strikethrough, Heading1, Heading2,
  List, ListOrdered, Quote, Link as LinkIcon, Code,
} from 'lucide-react';

import { cn } from '@/lib/utils';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  className?: string;
}

// Legacy sections hold plain text. Escape HTML-special chars so they render as
// literal text, then turn blank lines into paragraphs and single newlines into
// <br> so old multi-line notes keep their shape.
function plainToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// New sections hold HTML; old ones hold plain text. If there's no '<', treat it
// as legacy plain text and convert. Empty string => empty editor.
function toEditorContent(value: string): string {
  if (!value) return '';
  return value.includes('<') ? value : plainToHtml(value);
}

// Tiptap returns '<p></p>' for an empty doc; normalize back to '' so blank
// sections stay truly empty in storage.
function fromEditor(html: string): string {
  return html === '<p></p>' ? '' : html;
}

export function RichTextEditor({ value, onChange, className }: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false, // required under Next SSR to avoid hydration mismatch
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false, // Notion-lite: inline code only
        link: { openOnClick: false, autolink: true },
      }),
    ],
    content: toEditorContent(value),
    onUpdate: ({ editor }) => onChange(fromEditor(editor.getHTML())),
    editorProps: {
      attributes: {
        class: 'nexus-rte min-h-[80px] w-full rounded-md border border-border bg-accent px-3 py-2 text-sm',
      },
    },
  });

  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', prev ?? 'https://');
    if (url === null) return; // cancelled
    if (url === '') {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().setLink({ href: url }).run();
  };

  const btn = (active: boolean) =>
    cn(
      'inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
      active && 'border-border bg-accent text-foreground',
    );

  return (
    <div className={className}>
      <BubbleMenu
        editor={editor}
        className="flex items-center gap-0.5 rounded-md border border-border bg-card p-1 shadow-md"
      >
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive('bold'))} aria-label="Bold"><Bold className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive('italic'))} aria-label="Italic"><Italic className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btn(editor.isActive('underline'))} aria-label="Underline"><Underline className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()} className={btn(editor.isActive('strike'))} aria-label="Strikethrough"><Strikethrough className="h-3.5 w-3.5" /></button>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={btn(editor.isActive('heading', { level: 1 }))} aria-label="Heading 1"><Heading1 className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive('heading', { level: 2 }))} aria-label="Heading 2"><Heading2 className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive('bulletList'))} aria-label="Bullet list"><List className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive('orderedList'))} aria-label="Numbered list"><ListOrdered className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btn(editor.isActive('blockquote'))} aria-label="Quote"><Quote className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => editor.chain().focus().toggleCode().run()} className={btn(editor.isActive('code'))} aria-label="Inline code"><Code className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={setLink} className={btn(editor.isActive('link'))} aria-label="Link"><LinkIcon className="h-3.5 w-3.5" /></button>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
}
