import { TransformRule, applyRules, getDateSeparator, DateSeparator, DateFormat } from './rules'

export interface FileItem {
  originalPath: string
  originalName: string
  newName: string
  newPath: string // Full new path (with folder)
  isJournal: boolean // Whether it's a journal file
  content: string
  transformedContent: string
  changes: string[]
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
 * Parse Roam date format filename
 * e.g. "February 1st, 2023.md" → { year: 2023, month: 2, day: 1 }
 */
function parseRoamDateFileName(fileName: string): { year: number; month: number; day: number } | null {
  // Match format: Month Day(st/nd/rd/th), Year.md
  const match = fileName.match(/^(\w+)\s+(\d{1,2})(?:st|nd|rd|th),?\s+(\d{4})\.md$/i)
  if (!match) return null

  const [, monthName, dayStr, yearStr] = match
  const monthNum = MONTH_MAP[monthName.toLowerCase()]
  if (!monthNum) return null

  return {
    year: parseInt(yearStr, 10),
    month: parseInt(monthNum, 10),
    day: parseInt(dayStr, 10),
  }
}

/**
 * Parse dash date format filename
 * e.g. "2023-02-01.md" → { year: 2023, month: 2, day: 1 }
 */
function parseDashDateFileName(fileName: string): { year: number; month: number; day: number } | null {
  const match = fileName.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/i)
  if (!match) return null

  const [, yearStr, monthStr, dayStr] = match
  return {
    year: parseInt(yearStr, 10),
    month: parseInt(monthStr, 10),
    day: parseInt(dayStr, 10),
  }
}

/**
 * Parse underscore date format filename
 * e.g. "2023_02_01.md" → { year: 2023, month: 2, day: 1 }
 */
function parseUnderscoreDateFileName(fileName: string): { year: number; month: number; day: number } | null {
  const match = fileName.match(/^(\d{4})_(\d{2})_(\d{2})\.md$/i)
  if (!match) return null

  const [, yearStr, monthStr, dayStr] = match
  return {
    year: parseInt(yearStr, 10),
    month: parseInt(monthStr, 10),
    day: parseInt(dayStr, 10),
  }
}

/**
 * Parse date filename based on source format
 */
function parseDateFileName(fileName: string, sourceFormat: DateFormat): { year: number; month: number; day: number } | null {
  switch (sourceFormat) {
    case 'roam':
      return parseRoamDateFileName(fileName)
    case 'dash':
      return parseDashDateFileName(fileName)
    case 'underscore':
      return parseUnderscoreDateFileName(fileName)
    default:
      return null
  }
}

/**
 * Detect date format of filename (try all formats)
 */
function detectDateFormat(fileName: string): DateFormat | null {
  if (parseRoamDateFileName(fileName)) return 'roam'
  if (parseDashDateFileName(fileName)) return 'dash'
  if (parseUnderscoreDateFileName(fileName)) return 'underscore'
  return null
}

/**
 * Convert date filename to target format
 * Supports: roam, dash, underscore formats
 */
export function convertDateFileName(
  fileName: string,
  separator: DateSeparator = '-',
  sourceFormat?: DateFormat
): string | null {
  // If source format specified, use it; otherwise try to detect
  let parsed: { year: number; month: number; day: number } | null = null

  if (sourceFormat) {
    parsed = parseDateFileName(fileName, sourceFormat)
  } else {
    // Try all formats
    parsed = parseRoamDateFileName(fileName)
      || parseDashDateFileName(fileName)
      || parseUnderscoreDateFileName(fileName)
  }

  if (!parsed) return null

  const { year, month, day } = parsed
  const monthStr = month.toString().padStart(2, '0')
  const dayStr = day.toString().padStart(2, '0')

  return `${year}${separator}${monthStr}${separator}${dayStr}.md`
}

/**
 * Check if file is a journal (any date format)
 */
export function isJournalFile(fileName: string, sourceFormat?: DateFormat): boolean {
  if (sourceFormat) {
    return parseDateFileName(fileName, sourceFormat) !== null
  }
  return detectDateFormat(fileName) !== null
}

/**
 * Core sanitization logic for cross-platform compatibility and OSS upload
 * Shared between filename and link content sanitization
 */
export function sanitizeContent(text: string): string {
  return text
    // Book title brackets: << >> 《》 → hyphen
    .replace(/<<|>>/g, '-')
    .replace(/《|》/g, '-')
    // Arrows → hyphen
    .replace(/[→←↑↓↔↕➜➔➡⬅⬆⬇]/g, '-')
    // Other special chars incompatible with OSS/URL → delete
    .replace(/[<>:"/\\|?*!#+=\[\]{}'^$()]/g, '')
    // Multiple spaces → single space
    .replace(/\s+/g, ' ')
    // Trim leading/trailing spaces only
    .replace(/^\s+|\s+$/g, '')
}

/**
 * Sanitize filename for cross-platform compatibility and OSS upload
 * Handles: Windows forbidden chars, URL-unsafe chars, special Unicode
 */
export function sanitizeFileName(fileName: string): string {
  // Get extension
  const extMatch = fileName.match(/\.[^.]+$/)
  const ext = extMatch ? extMatch[0] : ''
  const baseName = ext ? fileName.slice(0, -ext.length) : fileName

  let sanitized = sanitizeContent(baseName)

  // If filename became empty, use a default
  if (!sanitized) {
    sanitized = 'untitled'
  }

  return sanitized + ext
}

// Flatten path: folder/note.md → folder_note.md
export function flattenFileName(path: string, shouldSanitize: boolean = true): string {
  // Remove leading ./
  const cleanPath = path.replace(/^\.\//, '')
  // Replace path separators with underscore
  const flattened = cleanPath.replace(/\//g, '_')
  // Sanitize the result if enabled
  return shouldSanitize ? sanitizeFileName(flattened) : flattened
}

// Compare changes
export function diffChanges(original: string, transformed: string): string[] {
  const changes: string[] = []
  const originalLines = original.split('\n')
  const transformedLines = transformed.split('\n')

  for (let i = 0; i < Math.max(originalLines.length, transformedLines.length); i++) {
    const orig = originalLines[i] || ''
    const trans = transformedLines[i] || ''
    if (orig !== trans) {
      changes.push(`L${i + 1}: "${orig.trim()}" → "${trans.trim()}"`)
    }
  }
  return changes
}

// Process single file
export function processFile(
  path: string,
  content: string,
  rules: TransformRule[]
): FileItem {
  const transformedContent = applyRules(content, rules)
  const originalName = path.split('/').pop() || path

  // Check if OSS compatibility (link-sanitize) rule is enabled
  const shouldSanitize = rules.find(r => r.id === 'link-sanitize')?.enabled ?? true
  // Check if journal folder rule is enabled
  const useJournalFolder = rules.find(r => r.id === 'journal-folder')?.enabled ?? true
  // Get date separator and source format from rules
  const dateSeparator = getDateSeparator(rules)
  const dateRule = rules.find(r => r.id === 'date-link')
  const dateSourceFormat = (dateRule?.options?.dateSourceFormat || 'roam') as DateFormat

  // Check if file is already in pages/ or journals/ folder
  const isInPages = path.startsWith('pages/') || path.startsWith('./pages/')
  const isInJournals = path.startsWith('journals/') || path.startsWith('./journals/')

  // Check if journal file and convert filename (use source format for detection)
  const isJournal = isJournalFile(originalName, dateSourceFormat)
  let newName: string
  let newPath: string

  if (isInPages || isInJournals) {
    // Already in pages/ or journals/ - keep original structure, just sanitize filename if needed
    newName = shouldSanitize ? sanitizeFileName(originalName) : originalName
    // Convert date format for journal files (pass source format)
    if (isJournal) {
      const dateConverted = convertDateFileName(originalName, dateSeparator, dateSourceFormat)
      newName = dateConverted || newName
    }
    newPath = isInJournals ? `journals/${newName}` : `pages/${newName}`
  } else if (isJournal) {
    // Journal file: convert date format (pass source format)
    const dateConverted = convertDateFileName(originalName, dateSeparator, dateSourceFormat)
    newName = dateConverted || (shouldSanitize ? sanitizeFileName(originalName) : originalName)
    // Put in journals folder if rule is enabled, otherwise in pages folder
    newPath = useJournalFolder ? `journals/${newName}` : `pages/${newName}`
  } else {
    // Non-journal file: flatten path, optionally sanitize, put in pages folder
    newName = flattenFileName(path, shouldSanitize)
    newPath = `pages/${newName}`
  }

  return {
    originalPath: path,
    originalName,
    newName,
    newPath,
    isJournal,
    content,
    transformedContent,
    changes: diffChanges(content, transformedContent),
  }
}
