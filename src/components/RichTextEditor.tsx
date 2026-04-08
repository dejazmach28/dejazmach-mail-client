import { EditorContent, useEditor } from "@tiptap/react";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { useEffect } from "react";

type RichTextEditorProps = {
  value: string;
  onChange: (html: string, plain: string) => void;
};

const htmlToPlain = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: {},
        codeBlock: {},
      }),
      Underline,
      Link.configure({ openOnClick: false }),
    ],
    content: value,
    onUpdate({ editor: ed }) {
      const html = ed.getHTML();
      onChange(html, htmlToPlain(html));
    },
  });

  // Sync external value changes (e.g. reply quote inserted)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== value) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  if (!editor) return null;

  const btn = (
    label: string,
    active: boolean,
    action: () => void,
    title?: string
  ) => (
    <button
      aria-label={title ?? label}
      className={active ? "rte-btn rte-btn-active" : "rte-btn"}
      onMouseDown={(e) => { e.preventDefault(); action(); }}
      title={title ?? label}
      type="button"
    >
      {label}
    </button>
  );

  return (
    <div className="rte-shell">
      <div className="rte-toolbar" role="toolbar" aria-label="Formatting">
        {btn("B", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "Bold")}
        {btn("I", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "Italic")}
        {btn("U", editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), "Underline")}
        {btn("S", editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), "Strikethrough")}
        <span className="rte-sep" />
        {btn("H1", editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), "Heading 1")}
        {btn("H2", editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "Heading 2")}
        <span className="rte-sep" />
        {btn("≡", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "Bullet list")}
        {btn("1.", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "Numbered list")}
        <span className="rte-sep" />
        {btn(
          "🔗",
          editor.isActive("link"),
          () => {
            if (editor.isActive("link")) {
              editor.chain().focus().unsetLink().run();
              return;
            }

            const url = window.prompt("Enter URL:");
            if (url?.trim()) {
              editor.chain().focus().setLink({ href: url.trim() }).run();
            }
          },
          "Link"
        )}
        <span className="rte-sep" />
        {btn("❝", editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), "Blockquote")}
        {btn("<>", editor.isActive("code"), () => editor.chain().focus().toggleCode().run(), "Inline code")}
        <span className="rte-sep" />
        <button
          aria-label="Clear formatting"
          className="rte-btn"
          onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().clearNodes().unsetAllMarks().run(); }}
          title="Clear formatting"
          type="button"
        >
          ✕
        </button>
      </div>
      <EditorContent className="rte-content" editor={editor} />
    </div>
  );
}
