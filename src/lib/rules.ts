import { sanitizeContent } from './transformer'

// Date separator options
export type DateSeparator = '-' | '_'
// Date format options
export type DateFormat = 'roam' | 'dash' | 'underscore'  // roam: January 11th, 2026 | dash: 2026-01-11 | underscore: 2026_01_11

// Transform rule definition
export interface TransformRule {
  id: string
  name: string
  description: string
  enabled: boolean
  options?: {
    dateSeparator?: DateSeparator
    dateSourceFormat?: DateFormat   // Source date format
    dateTargetFormat?: DateFormat   // Target date format (dash or underscore only)
    todoSource?: string      // Source pattern, e.g. "{{[[TODO]]}}", "TODO"
    todoFormat?: string      // Target format, e.g. "[ ]", "- [ ]"
    doneSource?: string      // Source pattern, e.g. "{{[[DONE]]}}", "DONE"
    doneFormat?: string      // Target format, e.g. "[x]", "- [x]"
  }
  transform: (content: string, options?: TransformRule['options']) => string
}

// Get date separator from rules (based on target format)
export function getDateSeparator(rules: TransformRule[]): DateSeparator {
  const dateRule = rules.find(r => r.id === 'date-link')
  const targetFormat = dateRule?.options?.dateTargetFormat || 'dash'
  return targetFormat === 'underscore' ? '_' : '-'
}

// Month name mapping
const MONTH_MAP: Record<string, string> = {
  'january': '01',
  'february': '02',
  'march': '03',
  'april': '04',
  'may': '05',
  'june': '06',
  'july': '07',
  'august': '08',
  'september': '09',
  'october': '10',
  'november': '11',
  'december': '12',
}

/**
 * Convert Roam date link to standard format
 * [[January 11th, 2026]] → [[2026-01-11]] or [[2026_01_11]]
 */
function convertDateLink(match: string, month: string, day: string, year: string, separator: DateSeparator = '-'): string {
  const monthNum = MONTH_MAP[month.toLowerCase()]
  if (!monthNum) return match // Return original if month not found

  const dayNum = day.padStart(2, '0')
  return `[[${year}${separator}${monthNum}${separator}${dayNum}]]`
}

/**
 * Create date link converter with specified separator
 */
function createDateLinkConverter(separator: DateSeparator) {
  return (match: string, month: string, day: string, year: string) => {
    return convertDateLink(match, month, day, year, separator)
  }
}

/**
 * Parse Roam table and convert to Markdown table
 * Roam table is row-based: each top-level item is a row, children are columns
 * @param tableBlock Table content block
 * @param indent Indent string (to maintain hierarchy)
 */
function convertRoamTable(tableBlock: string, indent: string = ''): string {
  const lines = tableBlock.split('\n')
  const rows: string[][] = []
  let currentRow: string[] = []
  let maxCols = 0
  let baseIndent = -1

  for (const line of lines) {
    // Skip {{[[table]]}} marker line
    if (line.includes('{{[[table]]}}')) continue

    // Match list item: capture indent and content
    const match = line.match(/^(\s*)[-*]\s+(.*)$/)
    if (!match) continue

    const lineIndent = match[1].length
    const content = match[2].trim()

    // Skip empty content
    if (!content) continue

    // Set base indent (first valid line's indent)
    if (baseIndent < 0) {
      baseIndent = lineIndent
    }

    // Calculate relative indent level
    const relativeIndent = lineIndent - baseIndent
    const colIndex = relativeIndent <= 0 ? 0 : Math.floor(relativeIndent / 4) || Math.floor(relativeIndent / 2)

    if (colIndex === 0) {
      // New row starts
      if (currentRow.length > 0) {
        rows.push(currentRow)
        maxCols = Math.max(maxCols, currentRow.length)
      }
      currentRow = [content]
    } else {
      // Next column in same row
      while (currentRow.length < colIndex) {
        currentRow.push('')
      }
      currentRow[colIndex] = content
    }
  }

  // Add last row
  if (currentRow.length > 0) {
    rows.push(currentRow)
    maxCols = Math.max(maxCols, currentRow.length)
  }

  if (rows.length === 0 || maxCols === 0) {
    return tableBlock
  }

  // Pad each row to max columns
  rows.forEach(row => {
    while (row.length < maxCols) {
      row.push('')
    }
  })

  // Generate Markdown table (with indent)
  const mdLines: string[] = []
  mdLines.push(indent + '| ' + rows[0].join(' | ') + ' |')
  mdLines.push(indent + '| ' + rows[0].map(() => '---').join(' | ') + ' |')
  for (let i = 1; i < rows.length; i++) {
    mdLines.push(indent + '| ' + rows[i].join(' | ') + ' |')
  }

  return mdLines.join('\n')
}

/**
 * Parse Roam kanban and convert to Markdown table
 * Roam kanban is column-based: each top-level item is a column header, children are column content
 * @param kanbanBlock Kanban content block
 * @param indent Indent string (to maintain hierarchy)
 */
function convertRoamKanban(kanbanBlock: string, indent: string = ''): string {
  const lines = kanbanBlock.split('\n')
  const columns: { header: string; items: string[] }[] = []
  let currentColumn: { header: string; items: string[] } | null = null
  let baseIndent = -1

  for (const line of lines) {
    // Skip {{[[kanban]]}} marker line
    if (line.includes('{{[[kanban]]}}')) continue

    // Match list item
    const match = line.match(/^(\s*)[-*]\s+(.*)$/)
    if (!match) continue

    const lineIndent = match[1].length
    const content = match[2].trim()

    // Set base indent
    if (baseIndent < 0 && content) {
      baseIndent = lineIndent
    }

    if (baseIndent < 0) continue

    const relativeIndent = lineIndent - baseIndent

    if (relativeIndent <= 0 && content) {
      // New column header
      if (currentColumn) {
        columns.push(currentColumn)
      }
      currentColumn = { header: content, items: [] }
    } else if (relativeIndent > 0 && currentColumn) {
      // Column content (skip empty items)
      if (content) {
        currentColumn.items.push(content)
      }
    }
  }

  // Add last column
  if (currentColumn) {
    columns.push(currentColumn)
  }

  if (columns.length === 0) {
    return kanbanBlock
  }

  // Find max rows
  const maxRows = Math.max(...columns.map(c => c.items.length), 1)

  // Generate Markdown table (with indent)
  const mdLines: string[] = []

  // Header
  mdLines.push(indent + '| ' + columns.map(c => c.header).join(' | ') + ' |')
  mdLines.push(indent + '| ' + columns.map(() => '---').join(' | ') + ' |')

  // Data rows
  for (let i = 0; i < maxRows; i++) {
    const row = columns.map(c => c.items[i] || '')
    mdLines.push(indent + '| ' + row.join(' | ') + ' |')
  }

  return mdLines.join('\n')
}

// Built-in rules
export const builtInRules: TransformRule[] = [
  {
    id: 'todo',
    name: 'TODO Conversion',
    description: '{{[[TODO]]}} → [ ]',
    enabled: true,
    options: {
      todoSource: '{{[[TODO]]}}',
      todoFormat: '[ ]',
    },
    transform: (content, options) => {
      const source = options?.todoSource || '{{[[TODO]]}}'
      const format = options?.todoFormat || '[ ]'
      // Escape special regex characters in source
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return content.replace(new RegExp(escaped, 'g'), format)
    },
  },
  {
    id: 'done',
    name: 'DONE Conversion',
    description: '{{[[DONE]]}} → [x]',
    enabled: true,
    options: {
      doneSource: '{{[[DONE]]}}',
      doneFormat: '[x]',
    },
    transform: (content, options) => {
      const source = options?.doneSource || '{{[[DONE]]}}'
      const format = options?.doneFormat || '[x]'
      // Escape special regex characters in source
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return content.replace(new RegExp(escaped, 'g'), format)
    },
  },
  {
    id: 'highlight',
    name: 'Highlight Conversion',
    description: '^^text^^ → **text** (bold)',
    enabled: true,
    transform: (content) => content.replace(/\^\^(.+?)\^\^/g, '**$1**'),
  },
  {
    id: 'link-flatten',
    name: 'Link Path Flatten',
    description: '[[folder/note]] → [[folder_note]]',
    enabled: true,
    transform: (content) => content.replace(/\[\[([^\]\/]+?)\/([^\]]+?)\]\]/g, '[[$1_$2]]'),
  },
  {
    id: 'link-sanitize',
    name: 'OSS Upload Compatibility',
    description: '[[<<book>>]] → [[_book_]] (sanitize special chars)',
    enabled: true,
    transform: (content) => content.replace(
      /\[\[([^\]]+)\]\]/g,
      (match, linkText) => {
        const sanitized = sanitizeContent(linkText)
        // If unchanged, return original to avoid unnecessary modifications
        return sanitized === linkText ? match : `[[${sanitized}]]`
      }
    ),
  },
  {
    id: 'date-link',
    name: 'Date Link Conversion',
    description: '[[January 11th, 2026]] → [[2026-01-11]]',
    enabled: true,
    options: {
      dateSourceFormat: 'roam' as DateFormat,
      dateTargetFormat: 'dash' as DateFormat,
    },
    transform: (content, options) => {
      const sourceFormat = options?.dateSourceFormat || 'roam'
      const targetFormat = options?.dateTargetFormat || 'dash'
      const targetSeparator = targetFormat === 'underscore' ? '_' : '-'

      let result = content

      // Convert based on source format
      if (sourceFormat === 'roam') {
        // Roam format: [[January 11th, 2026]] → target
        result = result.replace(
          /\[\[(\w+)\s+(\d{1,2})(?:st|nd|rd|th),?\s+(\d{4})\]\]/gi,
          createDateLinkConverter(targetSeparator)
        )
      } else if (sourceFormat === 'dash') {
        // Dash format: [[2026-01-11]] → target
        result = result.replace(
          /\[\[(\d{4})-(\d{2})-(\d{2})\]\]/g,
          `[[$1${targetSeparator}$2${targetSeparator}$3]]`
        )
      } else if (sourceFormat === 'underscore') {
        // Underscore format: [[2026_01_11]] → target
        result = result.replace(
          /\[\[(\d{4})_(\d{2})_(\d{2})\]\]/g,
          `[[$1${targetSeparator}$2${targetSeparator}$3]]`
        )
      }

      return result
    },
  },
  {
    id: 'journal-folder',
    name: 'Journal Folder',
    description: 'Move journal files to journals/ folder',
    enabled: true,
    transform: (content) => content, // No content transform, only affects file path
  },
  {
    id: 'frontmatter-clean',
    name: 'Clean YAML Frontmatter',
    description: 'Remove extra title frontmatter',
    enabled: true,
    transform: (content) => content.replace(/^-\s*---\n\s*title:.*\n\s*---\n-/gm, '-'),
  },
  {
    id: 'table',
    name: 'Table Conversion',
    description: '{{[[table]]}} → Markdown table',
    enabled: true,
    transform: (content) => {
      // Handle Windows line endings
      const lines = content.split('\n').map(l => l.replace(/\r$/, ''))
      const result: string[] = []
      let i = 0

      while (i < lines.length) {
        const line = lines[i]
        // Check if table starts (supports - {{[[table]]}} or just {{[[table]]}})
        // Capture: leading spaces, list marker (- ), table marker
        const tableMatch = line.match(/^(\s*)(-\s*)?\{\{\[\[table\]\]\}\}\s*$/)

        if (tableMatch) {
          const leadingSpaces = tableMatch[1] || ''
          const listMarker = tableMatch[2] || '' // Capture "- " if exists
          const baseIndent = leadingSpaces.length
          const tableLines: string[] = [line]
          i++

          // Collect table content (deeper indented lines)
          while (i < lines.length) {
            const nextLine = lines[i]
            // Continue collecting empty lines
            if (nextLine.trim() === '') {
              tableLines.push(nextLine)
              i++
              continue
            }
            // Check indent
            const nextIndentMatch = nextLine.match(/^(\s*)/)
            const nextIndent = nextIndentMatch ? nextIndentMatch[1].length : 0
            // If shallower or equal indent with new list item/special marker, table ends
            if (nextIndent <= baseIndent && (nextLine.trim().startsWith('-') || nextLine.trim().startsWith('{'))) {
              break
            }
            tableLines.push(nextLine)
            i++
          }

          // Calculate table indent: leading spaces + list marker length
          const tableIndent = listMarker ? leadingSpaces + '  ' : leadingSpaces

          // Convert table, maintain original indent level
          const converted = convertRoamTable(tableLines.join('\n'), tableIndent)

          // If originally a list item, add list marker
          if (listMarker) {
            const tableRows = converted.split('\n')
            // First line with list marker, subsequent lines maintain indent
            result.push(leadingSpaces + listMarker + tableRows[0].trimStart())
            for (let j = 1; j < tableRows.length; j++) {
              result.push(tableRows[j])
            }
          } else {
            result.push(converted)
          }
        } else {
          result.push(line)
          i++
        }
      }

      return result.join('\n')
    },
  },
  {
    id: 'kanban',
    name: 'Kanban Conversion',
    description: '{{[[kanban]]}} → Markdown table',
    enabled: true,
    transform: (content) => {
      // Handle Windows line endings
      const lines = content.split('\n').map(l => l.replace(/\r$/, ''))
      const result: string[] = []
      let i = 0

      while (i < lines.length) {
        const line = lines[i]
        // Check if kanban starts
        // Capture: leading spaces, list marker (- ), kanban marker
        const kanbanMatch = line.match(/^(\s*)(-\s*)?\{\{\[\[kanban\]\]\}\}\s*$/)

        if (kanbanMatch) {
          const leadingSpaces = kanbanMatch[1] || ''
          const listMarker = kanbanMatch[2] || '' // Capture "- " if exists
          const baseIndent = leadingSpaces.length
          const kanbanLines: string[] = [line]
          i++

          while (i < lines.length) {
            const nextLine = lines[i]
            if (nextLine.trim() === '') {
              kanbanLines.push(nextLine)
              i++
              continue
            }
            const nextIndentMatch = nextLine.match(/^(\s*)/)
            const nextIndent = nextIndentMatch ? nextIndentMatch[1].length : 0
            if (nextIndent <= baseIndent && (nextLine.trim().startsWith('-') || nextLine.trim().startsWith('{'))) {
              break
            }
            kanbanLines.push(nextLine)
            i++
          }

          // Calculate table indent
          const tableIndent = listMarker ? leadingSpaces + '  ' : leadingSpaces

          // Convert kanban, maintain original indent level
          const converted = convertRoamKanban(kanbanLines.join('\n'), tableIndent)

          // If originally a list item, add list marker
          if (listMarker) {
            const tableRows = converted.split('\n')
            result.push(leadingSpaces + listMarker + tableRows[0].trimStart())
            for (let j = 1; j < tableRows.length; j++) {
              result.push(tableRows[j])
            }
          } else {
            result.push(converted)
          }
        } else {
          result.push(line)
          i++
        }
      }

      return result.join('\n')
    },
  },
]

// Apply all enabled rules
export function applyRules(content: string, rules: TransformRule[]): string {
  return rules
    .filter((r) => r.enabled)
    .reduce((text, rule) => rule.transform(text, rule.options), content)
}
