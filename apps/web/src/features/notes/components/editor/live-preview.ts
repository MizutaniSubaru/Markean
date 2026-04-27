import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

type OffsetRange = {
  from: number;
  to: number;
};

type MarkSpec = OffsetRange & {
  className: string;
};

type ReplacementSpec =
  | (OffsetRange & { kind: "hidden" })
  | (OffsetRange & { kind: "hr" })
  | (OffsetRange & { kind: "list"; marker: string });

type LinePlan = {
  lineNumber: number;
  from: number;
  to: number;
  alwaysLineClasses: string[];
  inactiveLineClasses: string[];
  inactiveHiddenRanges: OffsetRange[];
  inactiveMarks: MarkSpec[];
  inactiveReplacements: ReplacementSpec[];
};

type DocumentPreviewPlan = {
  lines: Map<number, LinePlan>;
};

type OccupiedRange = {
  from: number;
  to: number;
};

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

class ListBulletWidget extends WidgetType {
  private readonly marker: string;

  constructor(marker: string) {
    super();
    this.marker = marker;
  }

  eq(other: WidgetType): boolean {
    return other instanceof ListBulletWidget && this.marker === other.marker;
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

function createEmptyLinePlan(lineNumber: number, from: number, to: number): LinePlan {
  return {
    lineNumber,
    from,
    to,
    alwaysLineClasses: [],
    inactiveLineClasses: [],
    inactiveHiddenRanges: [],
    inactiveMarks: [],
    inactiveReplacements: [],
  };
}

function overlaps(ranges: OccupiedRange[], from: number, to: number): boolean {
  return ranges.some((range) => from < range.to && to > range.from);
}

function collectDelimitedInlineStyles(
  text: string,
  occupied: OccupiedRange[],
  delimiter: string,
  className: string,
  options?: {
    single?: boolean;
  },
): {
  hiddenRanges: OffsetRange[];
  marks: MarkSpec[];
} {
  const hiddenRanges: OffsetRange[] = [];
  const marks: MarkSpec[] = [];
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const open = text.indexOf(delimiter, searchFrom);
    if (open === -1) {
      break;
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
      break;
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

    hiddenRanges.push({ from: open, to: openEnd }, { from: close, to: closeEnd });
    marks.push({ from: openEnd, to: close, className });
    occupied.push({ from: open, to: closeEnd });
    searchFrom = closeEnd;
  }

  return { hiddenRanges, marks };
}

function buildInlineStylePlan(text: string): {
  hiddenRanges: OffsetRange[];
  marks: MarkSpec[];
} {
  const occupied: OccupiedRange[] = [];
  const hiddenRanges: OffsetRange[] = [];
  const marks: MarkSpec[] = [];

  const styles = [
    collectDelimitedInlineStyles(text, occupied, "`", "cm-md-code"),
    collectDelimitedInlineStyles(text, occupied, "~~", "cm-md-strikethrough"),
    collectDelimitedInlineStyles(text, occupied, "**", "cm-md-bold"),
    collectDelimitedInlineStyles(text, occupied, "__", "cm-md-bold"),
    collectDelimitedInlineStyles(text, occupied, "*", "cm-md-italic", { single: true }),
    collectDelimitedInlineStyles(text, occupied, "_", "cm-md-italic", { single: true }),
  ];

  for (const style of styles) {
    hiddenRanges.push(...style.hiddenRanges);
    marks.push(...style.marks);
  }

  return { hiddenRanges, marks };
}

function applyInlineStylePlan(plan: LinePlan, text: string): void {
  const inlinePlan = buildInlineStylePlan(text);
  plan.inactiveHiddenRanges.push(...inlinePlan.hiddenRanges);
  plan.inactiveMarks.push(...inlinePlan.marks);
}

function createRegularLinePlan(
  lineNumber: number,
  from: number,
  to: number,
  text: string,
): LinePlan {
  const plan = createEmptyLinePlan(lineNumber, from, to);

  if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(text)) {
    plan.inactiveReplacements.push({ from: 0, to: text.length, kind: "hr" });
    return plan;
  }

  const headingMatch = text.match(/^(\s{0,3})(#{1,3})\s+(.*)$/);
  if (headingMatch) {
    const markerFrom = headingMatch[1].length;
    const markerTo = markerFrom + headingMatch[2].length + 1;
    plan.alwaysLineClasses.push(`cm-md-h${headingMatch[2].length}`);
    plan.inactiveHiddenRanges.push({ from: markerFrom, to: markerTo });
    applyInlineStylePlan(plan, text);
    return plan;
  }

  const blockquoteMatch = text.match(/^(\s{0,3})>\s?/);
  if (blockquoteMatch) {
    const markerFrom = blockquoteMatch[1].length;
    const markerTo = markerFrom + blockquoteMatch[0].trimStart().length;
    plan.alwaysLineClasses.push("cm-md-blockquote");
    plan.inactiveHiddenRanges.push({ from: markerFrom, to: markerTo });
    applyInlineStylePlan(plan, text);
    return plan;
  }

  const unorderedListMatch = text.match(/^(\s*)([-+*])\s+/);
  if (unorderedListMatch) {
    const markerFrom = unorderedListMatch[1].length;
    const markerTo = markerFrom + unorderedListMatch[2].length + 1;
    plan.inactiveReplacements.push({ from: markerFrom, to: markerTo, kind: "list", marker: "•" });
    applyInlineStylePlan(plan, text);
    return plan;
  }

  const orderedListMatch = text.match(/^(\s*)(\d+)([.)])\s+/);
  if (orderedListMatch) {
    const markerFrom = orderedListMatch[1].length;
    const markerTo = markerFrom + orderedListMatch[2].length + orderedListMatch[3].length + 1;
    plan.inactiveReplacements.push({
      from: markerFrom,
      to: markerTo,
      kind: "list",
      marker: `${orderedListMatch[2]}${orderedListMatch[3]}`,
    });
    applyInlineStylePlan(plan, text);
    return plan;
  }

  applyInlineStylePlan(plan, text);
  return plan;
}

function applyCodeBlockLineClasses(lines: Map<number, LinePlan>, lineNumbers: number[]): void {
  if (lineNumbers.length === 0) {
    return;
  }

  if (lineNumbers.length === 1) {
    lines.get(lineNumbers[0])?.inactiveLineClasses.push(
      "cm-md-codeblock-line",
      "cm-md-codeblock-single",
    );
    return;
  }

  lineNumbers.forEach((lineNumber, index) => {
    const plan = lines.get(lineNumber);
    if (!plan) {
      return;
    }

    plan.inactiveLineClasses.push("cm-md-codeblock-line");
    if (index === 0) {
      plan.inactiveLineClasses.push("cm-md-codeblock-first");
    }
    if (index === lineNumbers.length - 1) {
      plan.inactiveLineClasses.push("cm-md-codeblock-last");
    }
  });
}

function buildDocumentPreviewPlan(state: EditorState): DocumentPreviewPlan {
  const lines = new Map<number, LinePlan>();
  let inCodeBlock = false;
  let codeBlockLineNumbers: number[] = [];

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const fenceMatch = line.text.match(/^\s*(```|~~~)/);

    if (fenceMatch) {
      const plan = createEmptyLinePlan(lineNumber, line.from, line.to);
      plan.inactiveReplacements.push({ from: 0, to: line.text.length, kind: "hidden" });
      lines.set(lineNumber, plan);

      if (inCodeBlock) {
        applyCodeBlockLineClasses(lines, codeBlockLineNumbers);
        codeBlockLineNumbers = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }

      continue;
    }

    const plan = inCodeBlock
      ? createEmptyLinePlan(lineNumber, line.from, line.to)
      : createRegularLinePlan(lineNumber, line.from, line.to, line.text);
    lines.set(lineNumber, plan);

    if (inCodeBlock) {
      codeBlockLineNumbers.push(lineNumber);
    }
  }

  if (inCodeBlock) {
    applyCodeBlockLineClasses(lines, codeBlockLineNumbers);
  }

  return { lines };
}

function getSelectionLineNumbers(state: EditorState): Set<number> {
  const lineNumbers = new Set<number>();

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.empty ? range.from : Math.max(range.from, range.to - 1)).number;

    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
      lineNumbers.add(lineNumber);
    }
  }

  return lineNumbers;
}

function getVisibleLineNumbers(view: EditorView): Set<number> {
  const lineNumbers = new Set<number>();

  for (const range of view.visibleRanges) {
    if (range.from === range.to) {
      continue;
    }

    const startLine = view.state.doc.lineAt(range.from).number;
    const endPos = Math.max(range.from, range.to - 1);
    const endLine = view.state.doc.lineAt(endPos).number;

    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
      lineNumbers.add(lineNumber);
    }
  }

  if (lineNumbers.size === 0 && view.state.doc.lines > 0) {
    lineNumbers.add(view.state.doc.lineAt(view.state.selection.main.head).number);
  }

  return lineNumbers;
}

function addLineClass(builder: RangeSetBuilder<Decoration>, lineFrom: number, classNames: string[]): void {
  if (classNames.length === 0) {
    return;
  }

  builder.add(lineFrom, lineFrom, Decoration.line({ class: classNames.join(" ") }));
}

function addInactiveDecorations(
  builder: RangeSetBuilder<Decoration>,
  plan: LinePlan,
): void {
  for (const range of plan.inactiveHiddenRanges) {
    if (range.from >= range.to) {
      continue;
    }

    builder.add(plan.from + range.from, plan.from + range.to, hiddenSyntaxDecoration);
  }

  for (const mark of plan.inactiveMarks) {
    builder.add(
      plan.from + mark.from,
      plan.from + mark.to,
      Decoration.mark({ class: mark.className }),
    );
  }

  for (const replacement of plan.inactiveReplacements) {
    let decoration: Decoration;

    if (replacement.kind === "hidden") {
      decoration = hiddenSyntaxDecoration;
    } else if (replacement.kind === "hr") {
      decoration = Decoration.replace({ widget: new HrWidget() });
    } else {
      decoration = Decoration.replace({
        widget: new ListBulletWidget(replacement.marker),
      });
    }

    builder.add(plan.from + replacement.from, plan.from + replacement.to, decoration);
  }
}

function buildDecorations(view: EditorView, documentPlan: DocumentPreviewPlan): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const activeLineNumbers = getSelectionLineNumbers(view.state);
  const relevantLineNumbers = getVisibleLineNumbers(view);

  for (const lineNumber of activeLineNumbers) {
    relevantLineNumbers.add(lineNumber);
  }

  const sortedLineNumbers = Array.from(relevantLineNumbers).sort((left, right) => left - right);

  for (const lineNumber of sortedLineNumbers) {
    const plan = documentPlan.lines.get(lineNumber);
    if (!plan) {
      continue;
    }

    addLineClass(builder, plan.from, plan.alwaysLineClasses);
    if (activeLineNumbers.has(lineNumber)) {
      continue;
    }

    addLineClass(builder, plan.from, plan.inactiveLineClasses);
    addInactiveDecorations(builder, plan);
  }

  return builder.finish();
}

class LivePreviewPluginValue {
  decorations: DecorationSet;
  private documentPlan: DocumentPreviewPlan;

  constructor(view: EditorView) {
    this.documentPlan = buildDocumentPreviewPlan(view.state);
    this.decorations = buildDecorations(view, this.documentPlan);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.documentPlan = buildDocumentPreviewPlan(update.state);
    }

    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildDecorations(update.view, this.documentPlan);
    }
  }
}

export const livePreviewPlugin = ViewPlugin.fromClass(LivePreviewPluginValue, {
  decorations: (value) => value.decorations,
});
