import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { livePreviewPlugin } from "./live-preview";
import "../../../../styles/editor.css";

type MarkeanEditorProps = {
  content: string;
  onChange: (nextContent: string) => void;
};

export function MarkeanEditor({ content, onChange }: MarkeanEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const isApplyingExternalChangeRef = useRef(false);

  onChangeRef.current = onChange;

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) {
      return undefined;
    }

    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          markdown(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          livePreviewPlugin,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || isApplyingExternalChangeRef.current) {
              return;
            }

            onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
      parent,
    });

    viewRef.current = view;

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentContent = view.state.doc.toString();
    if (currentContent === content) {
      return;
    }

    isApplyingExternalChangeRef.current = true;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: content,
      },
    });
    isApplyingExternalChangeRef.current = false;
  }, [content]);

  return <div ref={containerRef} className="editor-content" />;
}
