const welcomeEn = `# Welcome to Markean

Markean is a Markdown note editor that syncs across devices.

## Quick Start

- **Create a folder** — click the + button in the sidebar
- **Create a note** — click the compose button in the note list
- **Edit in Markdown** — just start typing, the editor renders your formatting live

## Markdown Basics

### Headings

Use \`#\` for headings:

\`\`\`markdown
# Heading 1
## Heading 2
### Heading 3
\`\`\`

### Formatting

- **Bold** — wrap text in \`**double asterisks**\`
- *Italic* — wrap text in \`*single asterisks*\`
- \`Code\` — wrap text in backticks

> Blockquotes start with \`>\`

---

Happy writing!`;

const welcomeZh = `# 欢迎使用 Markean

Markean 是一款跨设备同步的 Markdown 笔记编辑器。

## 快速上手

- **创建文件夹** — 点击侧边栏的 + 按钮
- **创建笔记** — 点击笔记列表的编辑按钮
- **Markdown 编辑** — 直接输入，编辑器会实时渲染格式

## Markdown 基础

### 标题

使用 \`#\` 创建标题：

\`\`\`markdown
# 一级标题
## 二级标题
### 三级标题
\`\`\`

### 格式化

- **加粗** — 用 \`**双星号**\` 包裹文字
- *斜体* — 用 \`*单星号*\` 包裹文字
- \`代码\` — 用反引号包裹文字

> 引用块以 \`>\` 开头

---

开始写作吧！`;

export function getWelcomeNote(locale: string): { title: string; body: string } {
  if (locale.startsWith("zh")) {
    return { title: "欢迎使用 Markean", body: welcomeZh };
  }

  return { title: "Welcome to Markean", body: welcomeEn };
}
