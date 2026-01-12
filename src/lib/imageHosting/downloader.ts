/**
 * Download remote images
 * Supports retry logic and timeout handling
 */

const DEFAULT_TIMEOUT = 30000 // 30 second timeout
const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // Retry interval

/**
 * Delay function
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Download image via Canvas (bypasses some CORS restrictions)
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
          reject(new Error('Canvas not available'))
          return
        }
        ctx.drawImage(img, 0, 0)
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('Canvas conversion failed'))
          }
        }, 'image/png')
      } catch (err) {
        reject(new Error('CORS restriction: Cannot read cross-origin image'))
      }
    }

    img.onerror = () => {
      reject(new Error('Image load failed'))
    }

    img.src = url
  })
}

/**
 * Download a single image with retry logic
 * @param url Image URL
 * @param timeout Timeout in milliseconds
 * @param retries Number of retries
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

      // Try fetch first
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

      // If CORS error, try Canvas approach
      if (lastError.message.includes('CORS') || lastError.name === 'TypeError') {
        try {
          console.log(`Trying Canvas download: ${url}`)
          const blob = await downloadViaCanvas(url)
          return blob
        } catch (canvasError) {
          lastError = canvasError as Error
        }
      }

      // If abort error, convert to timeout error
      if (lastError.name === 'AbortError') {
        lastError = new Error(`Download timeout (${timeout / 1000}s)`)
      }

      // If retries remaining, wait and retry
      if (attempt < retries) {
        await delay(RETRY_DELAY * attempt) // Incremental delay
        continue
      }
    }
  }

  throw lastError || new Error('Download failed')
}

/**
 * Image cache to avoid duplicate downloads
 */
const imageCache = new Map<string, Blob>()

/**
 * Download image with caching
 */
export async function downloadImageWithCache(url: string): Promise<Blob> {
  // Check cache
  if (imageCache.has(url)) {
    return imageCache.get(url)!
  }

  // Download and cache
  const blob = await downloadImage(url)
  imageCache.set(url, blob)

  return blob
}

/**
 * Clear image cache
 */
export function clearImageCache(): void {
  imageCache.clear()
}

/**
 * Get cache size
 */
export function getImageCacheSize(): number {
  return imageCache.size
}
