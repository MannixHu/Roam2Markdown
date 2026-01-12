# Roam2Markdown

A web-based tool for migrating Roam Research notes to standard Markdown format, optimized for Obsidian, Logseq, and other PKM tools.

## Features

### Format Conversion
| Roam Format | Markdown | Description |
|-------------|----------|-------------|
| `{{[[TODO]]}}` | `[ ]` | Todo item |
| `{{[[DONE]]}}` | `[x]` | Completed item |
| `^^text^^` | `**text**` | Bold (highlight) |
| `{{[[table]]}}` | Markdown table | Table conversion |
| `{{[[kanban]]}}` | Markdown table | Kanban board |
| `[[folder/note]]` | `[[folder_note]]` | Link path flatten |
| `[[<<book>>]]` | `[[_book_]]` | OSS Upload Compatibility |
| `[[January 11th, 2026]]` | `[[2026-01-11]]` | Date link conversion |

### File Organization
- Journal files: `February 1st, 2023.md` → `journals/2023-02-01.md`
- Other files → `pages/` folder
- Filename sanitization (controlled by "OSS Upload Compatibility" rule)
  - `<<高效能人士的七个习惯>>.md` → `_高效能人士的七个习惯_.md`
  - Handles: `< > : " / \ | ? * ! → ← 《 》` → `_` or `-`
- Auto-filters macOS metadata files (`__MACOSX`, `._*`)

### Image Hosting Migration
- Migrate images from Firebase/other hosts to Aliyun OSS
- Breakpoint resumption support
- Batch processing with progress tracking
- Failed image retry

### Attachment Migration (Optional)
- Migrate PDF, DOC, audio, video and other files to OSS
- Supported formats:
  - `{{[[pdf]]: url}}` → `[filename.pdf](newUrl)`
  - Standalone URLs: `https://...file.docx` → `[filename.docx](newUrl)`
- Supports: pdf, doc, docx, xls, xlsx, ppt, pptx, md, txt, mp3, mp4, etc.

### Custom Rules
- Add custom regex-based transformation rules
- Toggle rules on/off
- Rules persist across sessions (IndexedDB)

## Usage

1. **Upload** - Drag & drop `.md` files or `.zip` archive
2. **Configure** - Click "rules" to enable/disable transformations
3. **Preview** - Review changes before downloading
4. **Download** - Get converted files as `.md` or `.zip`

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## Tech Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS v4
- Ant Design
- JSZip
- ali-oss

## License

MIT
