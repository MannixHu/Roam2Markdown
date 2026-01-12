import OSS from 'ali-oss'
import { OSSConfig } from './types'

/**
 * Validate OSS configuration
 */
export function validateOSSConfig(config: OSSConfig): { valid: boolean; error?: string } {
  if (!config.enabled) {
    return { valid: false, error: 'Image hosting migration not enabled' }
  }
  if (!config.accessKeyId?.trim()) {
    return { valid: false, error: 'Please enter Access Key ID' }
  }
  if (!config.accessKeySecret?.trim()) {
    return { valid: false, error: 'Please enter Access Key Secret' }
  }
  if (!config.bucket?.trim()) {
    return { valid: false, error: 'Please enter Bucket name' }
  }
  if (!config.region?.trim()) {
    return { valid: false, error: 'Please select a region' }
  }
  return { valid: true }
}

/**
 * Create OSS client
 */
export function createOSSClient(config: OSSConfig): OSS {
  const validation = validateOSSConfig(config)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  return new OSS({
    region: config.region,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    bucket: config.bucket,
    secure: true, // Use HTTPS
  })
}

// All supported file extensions (images + attachments)
const VALID_EXTENSIONS = [
  // Images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico',
  // Documents
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'md', 'txt', 'rtf', 'csv', 'json', 'xml',
  // Audio
  'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac',
  // Video
  'mp4', 'mov', 'avi', 'mkv', 'webm',
  // Archives
  'zip', 'rar', '7z', 'tar', 'gz',
]

// MIME type to extension mapping
const MIME_MAP: Record<string, string> = {
  // Images
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  // Documents
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/xml': 'xml',
  // Audio
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  // Video
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
  'video/webm': 'webm',
  // Archives
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z',
  'application/x-tar': 'tar',
  'application/gzip': 'gz',
}

/**
 * Generate filename: YYYY-MM-DD-HHmmss.ext format
 * Preserves original file format (images and attachments)
 */
export function generateFileName(originalUrl: string, storagePath?: string, mimeType?: string): string {
  // Decode URL to extract extension properly (for Firebase URLs etc.)
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(new URL(originalUrl).pathname)
  } catch {
    decodedPath = new URL(originalUrl).pathname
  }

  // Extract extension from decoded URL path
  const pathPart = decodedPath.split('?')[0]
  const extMatch = pathPart.match(/\.(\w+)$/i)
  const urlExt = extMatch ? extMatch[1].toLowerCase() : null

  // Prefer URL extension if valid
  let ext = (urlExt && VALID_EXTENSIONS.includes(urlExt)) ? urlExt : null

  // If URL has no valid extension, infer from MIME type
  if (!ext && mimeType) {
    ext = MIME_MAP[mimeType] || null
  }

  // Default to bin for unknown types
  ext = ext || 'bin'

  // Generate date-time formatted filename: YYYY-MM-DD-HHmmss
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  const ms = String(now.getMilliseconds()).padStart(3, '0')

  // Add milliseconds to avoid duplicate names within the same second
  const fileName = `${year}-${month}-${day}-${hours}${minutes}${seconds}${ms}.${ext}`

  // Combine with storage path
  if (storagePath) {
    const cleanPath = storagePath.replace(/^\/+|\/+$/g, '') // Remove leading/trailing slashes
    return `${cleanPath}/${fileName}`
  }

  return fileName
}

/**
 * Upload image to OSS
 * @param client OSS client
 * @param fileName Filename (including path)
 * @param data Image data (Blob or Buffer)
 * @returns Uploaded URL
 */
export async function uploadToOSS(
  client: OSS,
  fileName: string,
  data: Blob | Buffer
): Promise<string> {
  try {
    const result = await client.put(fileName, data)

    // Return HTTPS URL
    let url = result.url
    if (url.startsWith('http://')) {
      url = url.replace('http://', 'https://')
    }

    return url
  } catch (error) {
    const err = error as Error
    throw new Error(`Upload failed: ${err.message}`)
  }
}

/**
 * Generate CDN URL
 * @param bucket Bucket name
 * @param region Region
 * @param fileName Filename
 */
export function generateCDNUrl(bucket: string, region: string, fileName: string): string {
  return `https://${bucket}.${region}.aliyuncs.com/${fileName}`
}
