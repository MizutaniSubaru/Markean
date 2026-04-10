import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const livePreviewTheme = EditorView.theme({
  "&": { color: "#1d1d1f", backgroundColor: "transparent" },
});

const livePreviewHighlighting = HighlightStyle.define([
  { tag: t.heading, class: "cm-md-header" },
  { tag: t.processingInstruction, class: "cm-md-symbol" }, 
  { tag: t.punctuation, class: "cm-md-symbol" }
]);

export function LiveEditor({ initialValue = "", onChange }: { initialValue?: string, onChange?: (val: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView>();
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        livePreviewTheme,
        syntaxHighlighting(livePreviewHighlighting),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        })
      ]
    });

    const view = new EditorView({
      state,
      parent: containerRef.current
    });
    viewRef.current = view;

    return () => view.destroy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} style={{ height: "100%" }} />;
}