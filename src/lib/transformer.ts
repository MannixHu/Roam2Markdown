import { TransformRule, applyRules, getDateSeparator, DateSeparator } from './rules'

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
 * Convert Roam date filename to standard format
 * "February 1st, 2023.md" → "2023-02-01.md" or "2023_02_01.md"
 */
export function convertDateFileName(fileName: string, separator: DateSeparator = '-'): string | null {
  const parsed = parseRoamDateFileName(fileName)
  if (!parsed) return null

  const { year, month, day } = parsed
  const monthStr = month.toString().padStart(2, '0')
  const dayStr = day.toString().padStart(2, '0')

  return `${year}${separator}${monthStr}${separator}${dayStr}.md`
}

/**
 * Check if file is a journal (Roam date format)
 */
export function isJournalFile(fileName: string): boolean {
  return parseRoamDateFileName(fileName) !== null
}

/**
 * Core sanitization logic for cross-platform compatibility and OSS upload
 * Shared between filename and link content sanitization
 */
export function sanitizeContent(text: string): string {
  return text
    // Book title brackets first: << >> 《》 → single underscore each
    .replace(/<<|>>/g, '_')
    .replace(/《|》/g, '_')
    // Windows forbidden: < > : " / \ | ? *
    .replace(/[<>:"/\\|?*]/g, '_')
    // Arrows and special symbols: → ← ↑ ↓ ➜ etc
    .replace(/[→←↑↓↔↕➜➔➡⬅⬆⬇]/g, '-')
    // Exclamation marks (can cause issues in some shells)
    .replace(/!+/g, '')
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
  // Get date separator from rules
  const dateSeparator = getDateSeparator(rules)

  // Check if file is already in pages/ or journals/ folder
  const isInPages = path.startsWith('pages/') || path.startsWith('./pages/')
  const isInJournals = path.startsWith('journals/') || path.startsWith('./journals/')

  // Check if journal file and convert filename
  const isJournal = isJournalFile(originalName)
  let newName: string
  let newPath: string

  if (isInPages || isInJournals) {
    // Already in pages/ or journals/ - keep original structure, just sanitize filename if needed
    newName = shouldSanitize ? sanitizeFileName(originalName) : originalName
    // Convert date format for journal files
    if (isJournal) {
      const dateConverted = convertDateFileName(originalName, dateSeparator)
      newName = dateConverted || newName
    }
    newPath = isInJournals ? `journals/${newName}` : `pages/${newName}`
  } else if (isJournal) {
    // Journal file: convert date format
    const dateConverted = convertDateFileName(originalName, dateSeparator)
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
