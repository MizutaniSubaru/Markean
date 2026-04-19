import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

class HiddenSyntaxWidget extends WidgetType {
  eq(other: WidgetType): boolean {
    return other instanceof HiddenSyntaxWidget;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-hidden";
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class HrWidget extends WidgetType {
  eq(other: WidgetType): boolean {
    return other instanceof HrWidget;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-hr";
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class OliWidget extends WidgetType {
  constructor(private readonly marker: string) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof OliWidget && this.marker === other.marker;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-list-bullet";
    span.dataset.marker = this.marker;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const hiddenSyntaxDecoration = Decoration.replace({
  widget: new HiddenSyntaxWidget(),
});

function isCursorInRange(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from >= from && range.from <= to;
    }

    return range.from < to && range.to > from;
  });
}

function addLineClass(builder: RangeSetBuilder<Decoration>, lineFrom: number, className: string): void {
  builder.add(lineFrom, lineFrom, Decoration.line({ class: className }));
}

function hideRange(builder: RangeSetBuilder<Decoration>, from: number, to: number): void {
  if (from >= to) {
    return;
  }

  builder.add(from, to, hiddenSyntaxDecoration);
}

type OccupiedRange = {
  from: number;
  to: number;
};

function overlaps(ranges: OccupiedRange[], from: number, to: number): boolean {
  return ranges.some((range) => from < range.to && to > range.from);
}

function addDelimitedDecorations(
  builder: RangeSetBuilder<Decoration>,
  text: string,
  lineFrom: number,
  occupied: OccupiedRange[],
  delimiter: string,
  className: string,
  options?: {
    single?: boolean;
  },
): void {
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const open = text.indexOf(delimiter, searchFrom);
    if (open === -1) {
      return;
    }

    const openEnd = open + delimiter.length;
    if (
      options?.single &&
      (text.slice(open - delimiter.length, open) === delimiter ||
        text.slice(openEnd, openEnd + delimiter.length) === delimiter)
    ) {
      searchFrom = openEnd;
      continue;
    }

    const close = text.indexOf(delimiter, openEnd);
    if (close === -1) {
      return;
    }

    const closeEnd = close + delimiter.length;
    if (
      options?.single &&
      (text.slice(close - delimiter.length, close) === delimiter ||
        text.slice(closeEnd, closeEnd + delimiter.length) === delimiter)
    ) {
      searchFrom = openEnd;
      continue;
    }

    if (close === openEnd || overlaps(occupied, open, closeEnd)) {
      searchFrom = openEnd;
      continue;
    }

    const content = text.slice(openEnd, close);
    if (!content.trim()) {
      searchFrom = closeEnd;
      continue;
    }

    hideRange(builder, lineFrom + open, lineFrom + openEnd);
    hideRange(builder, lineFrom + close, lineFrom + closeEnd);
    builder.add(
      lineFrom + openEnd,
      lineFrom + close,
      Decoration.mark({ class: className }),
    );
    occupied.push({ from: open, to: closeEnd });
    searchFrom = closeEnd;
  }
}

function addInlineDecorations(
  builder: RangeSetBuilder<Decoration>,
  text: string,
  lineFrom: number,
): void {
  const occupied: OccupiedRange[] = [];

  addDelimitedDecorations(builder, text, lineFrom, occupied, "`", "cm-md-code");
  addDelimitedDecorations(builder, text, lineFrom, occupied, "~~", "cm-md-strikethrough");
  addDelimitedDecorations(builder, text, lineFrom, occupied, "**", "cm-md-bold");
  addDelimitedDecorations(builder, text, lineFrom, occupied, "__", "cm-md-bold");
  addDelimitedDecorations(builder, text, lineFrom, occupied, "*", "cm-md-italic", {
    single: true,
  });
  addDelimitedDecorations(builder, text, lineFrom, occupied, "_", "cm-md-italic", {
    single: true,
  });
}

function decorateCodeBlockLines(
  builder: RangeSetBuilder<Decoration>,
  lines: Array<{ from: number; to: number; cursor: boolean }>,
): void {
  if (lines.length === 0) {
    return;
  }

  if (lines.length === 1) {
    if (!lines[0].cursor) {
      addLineClass(
        builder,
        lines[0].from,
        "cm-md-codeblock-line cm-md-codeblock-single",
      );
    }
    return;
  }

  lines.forEach((line, index) => {
    if (line.cursor) {
      return;
    }

    const classes = ["cm-md-codeblock-line"];
    if (index === 0) {
      classes.push("cm-md-codeblock-first");
    }
    if (index === lines.length - 1) {
      classes.push("cm-md-codeblock-last");
    }

    addLineClass(builder, line.from, classes.join(" "));
  });
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;

  let inCodeBlock = false;
  let codeBlockLines: Array<{ from: number; to: number; cursor: boolean }> = [];

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const text = line.text;
    const cursorInLine = isCursorInRange(state, line.from, line.to);
    const fenceMatch = text.match(/^\s*(```|~~~)/);

    if (fenceMatch) {
      if (!cursorInLine) {
        hideRange(builder, line.from, line.to);
      }

      if (inCodeBlock) {
        decorateCodeBlockLines(builder, codeBlockLines);
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }

      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push({
        from: line.from,
        to: line.to,
        cursor: cursorInLine,
      });
      continue;
    }

    if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(text)) {
      if (!cursorInLine) {
        builder.add(
          line.from,
          line.to,
          Decoration.replace({ widget: new HrWidget() }),
        );
      }
      continue;
    }

    const headingMatch = text.match(/^(\s{0,3})(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      addLineClass(builder, line.from, `cm-md-h${headingMatch[2].length}`);
      if (!cursorInLine) {
        const markerFrom = line.from + headingMatch[1].length;
        const markerTo = markerFrom + headingMatch[2].length + 1;
        hideRange(builder, markerFrom, markerTo);
        addInlineDecorations(builder, text, line.from);
      }
      continue;
    }

    const blockquoteMatch = text.match(/^(\s{0,3})>\s?/);
    if (blockquoteMatch) {
      addLineClass(builder, line.from, "cm-md-blockquote");
      if (!cursorInLine) {
        const markerFrom = line.from + blockquoteMatch[1].length;
        const markerTo = markerFrom + blockquoteMatch[0].trimStart().length;
        hideRange(builder, markerFrom, markerTo);
        addInlineDecorations(builder, text, line.from);
      }
      continue;
    }

    const unorderedListMatch = text.match(/^(\s*)([-+*])\s+/);
    if (unorderedListMatch) {
      if (!cursorInLine) {
        const markerFrom = line.from + unorderedListMatch[1].length;
        const markerTo = markerFrom + unorderedListMatch[2].length + 1;
        builder.add(
          markerFrom,
          markerTo,
          Decoration.replace({ widget: new OliWidget("•") }),
        );
        addInlineDecorations(builder, text, line.from);
      }
      continue;
    }

    const orderedListMatch = text.match(/^(\s*)(\d+)([.)])\s+/);
    if (orderedListMatch) {
      if (!cursorInLine) {
        const markerFrom = line.from + orderedListMatch[1].length;
        const markerTo =
          markerFrom + orderedListMatch[2].length + orderedListMatch[3].length + 1;
        builder.add(
          markerFrom,
          markerTo,
          Decoration.replace({
            widget: new OliWidget(`${orderedListMatch[2]}${orderedListMatch[3]}`),
          }),
        );
        addInlineDecorations(builder, text, line.from);
      }
      continue;
    }

    if (!cursorInLine) {
      addInlineDecorations(builder, text, line.from);
    }
  }

  if (inCodeBlock) {
    decorateCodeBlockLines(builder, codeBlockLines);
  }

  return builder.finish();
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.focusChanged
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
);
