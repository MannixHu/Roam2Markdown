import { TransformRule, applyRules } from './rules'

export interface FileItem {
  originalPath: string
  originalName: string
  newName: string
  newPath: string // 新增：完整的新路径（包含文件夹）
  isJournal: boolean // 新增：是否为日记文件
  content: string
  transformedContent: string
  changes: string[]
}

// 月份名称映射
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
 * 解析 Roam 日期格式文件名
 * 例如: "February 1st, 2023.md" → { year: 2023, month: 2, day: 1 }
 */
function parseRoamDateFileName(fileName: string): { year: number; month: number; day: number } | null {
  // 匹配格式：Month Day(st/nd/rd/th), Year.md
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
 * 将 Roam 日期文件名转换为标准格式
 * "February 1st, 2023.md" → "2023-02-01.md"
 */
export function convertDateFileName(fileName: string): string | null {
  const parsed = parseRoamDateFileName(fileName)
  if (!parsed) return null

  const { year, month, day } = parsed
  const monthStr = month.toString().padStart(2, '0')
  const dayStr = day.toString().padStart(2, '0')

  return `${year}-${monthStr}-${dayStr}.md`
}

/**
 * 判断是否为日记文件（Roam 日期格式）
 */
export function isJournalFile(fileName: string): boolean {
  return parseRoamDateFileName(fileName) !== null
}

// 处理文件名：folder/note.md → folder_note.md
export function flattenFileName(path: string): string {
  // 去掉开头的 ./
  const cleanPath = path.replace(/^\.\//, '')
  // 将路径分隔符替换为下划线
  return cleanPath.replace(/\//g, '_')
}

// 对比变更
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

// 处理单个文件
export function processFile(
  path: string,
  content: string,
  rules: TransformRule[]
): FileItem {
  const transformedContent = applyRules(content, rules)
  const originalName = path.split('/').pop() || path

  // 检查是否为日记文件并转换文件名
  const isJournal = isJournalFile(originalName)
  let newName: string
  let newPath: string

  if (isJournal) {
    // 日记文件：转换日期格式，放入 journals 文件夹
    newName = convertDateFileName(originalName) || originalName
    newPath = `journals/${newName}`
  } else {
    // 非日记文件：保持原名（扁平化路径），放入 pages 文件夹
    newName = flattenFileName(path)
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
