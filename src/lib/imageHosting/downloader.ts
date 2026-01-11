/**
 * 下载远程图片
 * 支持重试逻辑和超时处理
 */

const DEFAULT_TIMEOUT = 30000 // 30秒超时
const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 重试间隔

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 使用 Canvas 下载图片（绕过部分 CORS 限制）
 */
function downloadViaCanvas(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas 不可用'))
          return
        }
        ctx.drawImage(img, 0, 0)
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Canvas 转换失败'))
          }
        }, 'image/png')
      } catch (err) {
        reject(new Error('CORS 限制: 无法读取跨域图片'))
      }
    }

    img.onerror = () => {
      reject(new Error('图片加载失败'))
    }

    img.src = url
  })
}

/**
 * 下载单张图片，带重试逻辑
 * @param url 图片 URL
 * @param timeout 超时时间（毫秒）
 * @param retries 重试次数
 */
export async function downloadImage(
  url: string,
  timeout: number = DEFAULT_TIMEOUT,
  retries: number = MAX_RETRIES
): Promise<Blob> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      // 先尝试 fetch
      const response = await fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        headers: {
          Accept: 'image/*',
        },
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const blob = await response.blob()
      return blob
    } catch (error) {
      lastError = error as Error

      // 如果是 CORS 错误，尝试使用 Canvas 方式
      if (lastError.message.includes('CORS') || lastError.name === 'TypeError') {
        try {
          console.log(`尝试 Canvas 方式下载: ${url}`)
          const blob = await downloadViaCanvas(url)
          return blob
        } catch (canvasError) {
          lastError = canvasError as Error
        }
      }

      // 如果是中止错误，转换为超时错误
      if (lastError.name === 'AbortError') {
        lastError = new Error(`下载超时 (${timeout / 1000}秒)`)
      }

      // 如果还有重试机会，等待后重试
      if (attempt < retries) {
        await delay(RETRY_DELAY * attempt) // 递增延迟
        continue
      }
    }
  }

  throw lastError || new Error('下载失败')
}

/**
 * 图片缓存，避免重复下载
 */
const imageCache = new Map<string, Blob>()

/**
 * 下载图片（带缓存）
 */
export async function downloadImageWithCache(url: string): Promise<Blob> {
  // 检查缓存
  if (imageCache.has(url)) {
    return imageCache.get(url)!
  }

  // 下载并缓存
  const blob = await downloadImage(url)
  imageCache.set(url, blob)

  return blob
}

/**
 * 清除图片缓存
 */
export function clearImageCache(): void {
  imageCache.clear()
}

/**
 * 获取缓存大小
 */
export function getImageCacheSize(): number {
  return imageCache.size
}
