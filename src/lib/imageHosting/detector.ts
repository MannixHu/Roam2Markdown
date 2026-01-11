import { ImageInfo } from './types'

/**
 * 检测 markdown 中的图片链接
 * 支持两种格式:
 * 1. Markdown 语法: ![alt](url "title")
 * 2. HTML 语法: <img src="url" alt="alt" title="title">
 */
export function detectImageLinks(content: string): ImageInfo[] {
  const images: ImageInfo[] = []

  // 匹配 markdown 格式: ![alt](url "title")
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

  // 匹配 HTML 格式: <img src="url" alt="alt" title="title">
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
 * 判断是否为远程图片 URL
 */
export function isRemoteImage(url: string): boolean {
  // 以 http:// 或 https:// 开头的是远程图片
  return /^https?:\/\//i.test(url)
}

/**
 * 判断图片是否来自指定的图床域名
 * @param url 图片 URL
 * @param domain 图床域名，例如 'aliyuncs.com'
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
 * 过滤需要迁移的图片
 * 规则：
 * 1. 必须是远程图片
 * 2. 不能已经在目标图床上
 * @param images 所有图片信息
 * @param targetDomain 目标图床域名，例如 'aliyuncs.com'
 */
export function filterImagesToMigrate(
  images: ImageInfo[],
  targetDomain: string
): ImageInfo[] {
  return images.filter((img) => {
    // 必须是远程图片
    if (!isRemoteImage(img.url)) {
      return false
    }

    // 不能已经在目标图床上
    if (isFromImageHost(img.url, targetDomain)) {
      return false
    }

    return true
  })
}

/**
 * 从 markdown 内容中提取所有需要迁移的图片
 * @param content markdown 内容
 * @param targetDomain 目标图床域名
 */
export function extractImagesToMigrate(
  content: string,
  targetDomain: string = 'aliyuncs.com'
): ImageInfo[] {
  const allImages = detectImageLinks(content)
  return filterImagesToMigrate(allImages, targetDomain)
}
