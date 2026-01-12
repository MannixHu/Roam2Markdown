import { ImageInfo, AttachmentInfo } from './types'

/**
 * Detect image links in markdown
 * Supports two formats:
 * 1. Markdown syntax: ![alt](url "title")
 * 2. HTML syntax: <img src="url" alt="alt" title="title">
 */
export function detectImageLinks(content: string): ImageInfo[] {
  const images: ImageInfo[] = []

  // Match markdown format: ![alt](url "title")
  const markdownImageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g
  let match: RegExpExecArray | null

  while ((match = markdownImageRegex.exec(content)) !== null) {
    const [, altText, url, title] = match
    images.push({
      url: url.trim(),
      altText: altText || undefined,
      title: title || undefined,
    })
  }

  // Match HTML format: <img src="url" alt="alt" title="title">
  const htmlImageRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi

  while ((match = htmlImageRegex.exec(content)) !== null) {
    const imgTag = match[0]
    const srcMatch = /src=["']([^"']+)["']/i.exec(imgTag)
    const altMatch = /alt=["']([^"']+)["']/i.exec(imgTag)
    const titleMatch = /title=["']([^"']+)["']/i.exec(imgTag)

    if (srcMatch) {
      images.push({
        url: srcMatch[1].trim(),
        altText: altMatch?.[1] || undefined,
        title: titleMatch?.[1] || undefined,
      })
    }
  }

  return images
}

/**
 * Check if URL is a remote image
 */
export function isRemoteImage(url: string): boolean {
  // URLs starting with http:// or https:// are remote images
  return /^https?:\/\//i.test(url)
}

/**
 * Check if image is from a specified image hosting domain
 * @param url Image URL
 * @param domain Image hosting domain, e.g. 'aliyuncs.com'
 */
export function isFromImageHost(url: string, domain: string): boolean {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.includes(domain)
  } catch {
    return false
  }
}

/**
 * Filter images that need migration
 * Rules:
 * 1. Must be a remote image
 * 2. Must not already be on target host
 * @param images All image info
 * @param targetDomain Target image hosting domain, e.g. 'aliyuncs.com'
 */
export function filterImagesToMigrate(
  images: ImageInfo[],
  targetDomain: string
): ImageInfo[] {
  return images.filter((img) => {
    // Must be remote image
    if (!isRemoteImage(img.url)) {
      return false
    }

    // Must not already be on target host
    if (isFromImageHost(img.url, targetDomain)) {
      return false
    }

    return true
  })
}

/**
 * Extract all images that need migration from markdown content
 * @param content Markdown content
 * @param targetDomain Target image hosting domain
 */
export function extractImagesToMigrate(
  content: string,
  targetDomain: string = 'aliyuncs.com'
): ImageInfo[] {
  const allImages = detectImageLinks(content)
  return filterImagesToMigrate(allImages, targetDomain)
}

// Supported attachment file extensions
const ATTACHMENT_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'md', 'txt', 'rtf', 'csv', 'json', 'xml',
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
  'mp4', 'mov', 'avi', 'mkv', 'webm',
  'zip', 'rar', '7z', 'tar', 'gz',
]

/**
 * Detect Roam attachment links in content
 * Format: {{[[pdf]]: url}}, {{[[audio]]: url}}, {{[[video]]: url}}, etc.
 */
export function detectAttachmentLinks(content: string): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = []
  const seenUrls = new Set<string>()

  // Match Roam attachment format: {{[[type]]: url}}
  const roamRegex = /\{\{\[\[(\w+)\]\]:\s*(https?:\/\/[^\s}]+)\}\}/gi
  let match: RegExpExecArray | null

  while ((match = roamRegex.exec(content)) !== null) {
    const [originalMatch, type, url] = match
    // Skip image types (handled separately)
    if (['image', 'img'].includes(type.toLowerCase())) {
      continue
    }
    if (!seenUrls.has(url)) {
      seenUrls.add(url)
      attachments.push({
        url: url.trim(),
        type: type.toLowerCase(),
        originalMatch,
      })
    }
  }

  // Match standalone URLs (on their own line or after list marker)
  // e.g. "- https://firebase...file.pdf?..." or indented URLs
  const standaloneRegex = /(?:^|\n)(\s*-\s*)?(https?:\/\/[^\s\n]+)/gi

  while ((match = standaloneRegex.exec(content)) !== null) {
    const [fullMatch, listPrefix, url] = match

    // Decode URL to extract extension
    let decodedUrl: string
    try {
      decodedUrl = decodeURIComponent(url)
    } catch {
      decodedUrl = url
    }

    // Extract extension from decoded URL path (before query string)
    const pathPart = decodedUrl.split('?')[0]
    const extMatch = pathPart.match(/\.(\w+)$/i)
    const ext = extMatch ? extMatch[1].toLowerCase() : null

    // Only process if it's an attachment extension and not already seen
    if (ext && ATTACHMENT_EXTENSIONS.includes(ext) && !seenUrls.has(url)) {
      seenUrls.add(url)

      // Preserve original format for replacement
      const originalMatch = listPrefix
        ? fullMatch.replace(/^\n/, '').trim()
        : url.trim()

      attachments.push({
        url: url.trim(),
        type: ext,
        originalMatch,
      })
    }
  }

  return attachments
}

/**
 * Filter attachments that need migration
 * @param attachments All attachment info
 * @param targetDomain Target domain, e.g. 'aliyuncs.com'
 */
export function filterAttachmentsToMigrate(
  attachments: AttachmentInfo[],
  targetDomain: string
): AttachmentInfo[] {
  return attachments.filter((att) => {
    // Must not already be on target host
    if (isFromImageHost(att.url, targetDomain)) {
      return false
    }
    return true
  })
}

/**
 * Extract all attachments that need migration from content
 * @param content Markdown content
 * @param targetDomain Target domain
 */
export function extractAttachmentsToMigrate(
  content: string,
  targetDomain: string = 'aliyuncs.com'
): AttachmentInfo[] {
  const allAttachments = detectAttachmentLinks(content)
  return filterAttachmentsToMigrate(allAttachments, targetDomain)
}
