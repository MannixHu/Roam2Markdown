import OSS from 'ali-oss'
import { OSSConfig } from './types'

/**
 * 验证 OSS 配置是否完整
 */
export function validateOSSConfig(config: OSSConfig): { valid: boolean; error?: string } {
  if (!config.enabled) {
    return { valid: false, error: '图床迁移未启用' }
  }
  if (!config.accessKeyId?.trim()) {
    return { valid: false, error: '请填写 Access Key ID' }
  }
  if (!config.accessKeySecret?.trim()) {
    return { valid: false, error: '请填写 Access Key Secret' }
  }
  if (!config.bucket?.trim()) {
    return { valid: false, error: '请填写 Bucket 名称' }
  }
  if (!config.region?.trim()) {
    return { valid: false, error: '请选择存储区域' }
  }
  return { valid: true }
}

/**
 * 创建 OSS 客户端
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
    secure: true, // 使用 HTTPS
  })
}

/**
 * 生成文件名：YYYY-MM-DD-HHmmss.ext 格式
 * 保留原始图片格式
 */
export function generateFileName(originalUrl: string, storagePath?: string, mimeType?: string): string {
  // 从 URL 中提取扩展名
  const urlPath = new URL(originalUrl).pathname
  const urlExt = urlPath.split('.').pop()?.toLowerCase()

  // 支持的图片格式
  const validExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']

  // 优先用 URL 中的扩展名
  let ext = (urlExt && validExts.includes(urlExt)) ? urlExt : null

  // 如果 URL 没有扩展名，从 MIME 类型推断
  if (!ext && mimeType) {
    const mimeMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/bmp': 'bmp',
      'image/x-icon': 'ico',
    }
    ext = mimeMap[mimeType] || null
  }

  // 最后默认 png（无损格式）
  ext = ext || 'png'

  // 生成日期时间格式文件名: YYYY-MM-DD-HHmmss
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  const ms = String(now.getMilliseconds()).padStart(3, '0')

  // 加毫秒避免同一秒内多张图片重名
  const fileName = `${year}-${month}-${day}-${hours}${minutes}${seconds}${ms}.${ext}`

  // 组合存储路径
  if (storagePath) {
    const cleanPath = storagePath.replace(/^\/+|\/+$/g, '') // 去除首尾斜杠
    return `${cleanPath}/${fileName}`
  }

  return fileName
}

/**
 * 上传图片到 OSS
 * @param client OSS 客户端
 * @param fileName 文件名（包含路径）
 * @param data 图片数据（Blob 或 Buffer）
 * @returns 上传后的 URL
 */
export async function uploadToOSS(
  client: OSS,
  fileName: string,
  data: Blob | Buffer
): Promise<string> {
  try {
    const result = await client.put(fileName, data)

    // 返回 HTTPS URL
    let url = result.url
    if (url.startsWith('http://')) {
      url = url.replace('http://', 'https://')
    }

    return url
  } catch (error) {
    const err = error as Error
    throw new Error(`上传失败: ${err.message}`)
  }
}

/**
 * 生成 CDN URL
 * @param bucket Bucket 名称
 * @param region 区域
 * @param fileName 文件名
 */
export function generateCDNUrl(bucket: string, region: string, fileName: string): string {
  return `https://${bucket}.${region}.aliyuncs.com/${fileName}`
}
