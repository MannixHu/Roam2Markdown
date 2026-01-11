import { OSSConfig, MigrationProgress, MigrationSession, FileMigrationState, ImageMigrationState } from './types'
import { extractImagesToMigrate } from './detector'
import { createOSSClient, generateFileName, uploadToOSS, validateOSSConfig } from './ossClient'
import { downloadImageWithCache, clearImageCache } from './downloader'
import { saveMigrationSession, getLatestPendingSession, deleteMigrationSession } from '../storage'

/**
 * 单个图片迁移结果
 */
export interface ImageMigrationResult {
  originalUrl: string
  newUrl?: string
  success: boolean
  error?: string
}

/**
 * 文件迁移结果
 */
export interface FileMigrationResult {
  originalContent: string
  migratedContent: string
  images: ImageMigrationResult[]
  success: boolean
}

/**
 * 迁移进度回调
 */
export type ProgressCallback = (progress: MigrationProgress) => void

/**
 * 迁移控制器（用于暂停/继续）
 */
export interface MigrationController {
  pause: () => void
  resume: () => void
  stop: () => void
  isPaused: () => boolean
  isStopped: () => boolean
}

/**
 * 创建迁移控制器
 */
export function createMigrationController(): MigrationController {
  let paused = false
  let stopped = false

  return {
    pause: () => { paused = true },
    resume: () => { paused = false },
    stop: () => { stopped = true },
    isPaused: () => paused,
    isStopped: () => stopped,
  }
}

/**
 * 等待恢复（如果暂停）
 */
async function waitIfPaused(controller: MigrationController): Promise<boolean> {
  while (controller.isPaused() && !controller.isStopped()) {
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return controller.isStopped()
}

/**
 * 替换内容中的图片 URL
 */
function replaceImageUrl(
  content: string,
  originalUrl: string,
  newUrl: string
): string {
  // 转义特殊字符用于正则匹配
  const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // 替换 markdown 格式: ![alt](url)
  const mdRegex = new RegExp(`(!\\[[^\\]]*\\])\\(${escapedUrl}(\\s*"[^"]*")?\\)`, 'g')
  content = content.replace(mdRegex, `$1(${newUrl}$2)`)

  // 替换 HTML 格式: <img src="url">
  const htmlRegex = new RegExp(`(<img[^>]+src=["'])${escapedUrl}(["'][^>]*>)`, 'gi')
  content = content.replace(htmlRegex, `$1${newUrl}$2`)

  return content
}

/**
 * 生成会话 ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 创建新的迁移会话
 */
export function createMigrationSession(
  files: Array<{ path: string; content: string }>
): MigrationSession {
  const now = Date.now()
  let totalImages = 0

  const filesState: Record<string, FileMigrationState> = {}

  for (const file of files) {
    const images = extractImagesToMigrate(file.content, 'aliyuncs.com')
    totalImages += images.length

    const imagesState: Record<string, ImageMigrationState> = {}
    for (const img of images) {
      imagesState[img.url] = { status: 'pending' }
    }

    filesState[file.path] = {
      status: 'pending',
      originalContent: file.content,
      migratedContent: file.content,
      images: imagesState,
    }
  }

  return {
    id: generateSessionId(),
    startedAt: now,
    updatedAt: now,
    status: 'running',
    totalFiles: files.length,
    totalImages,
    processedFiles: 0,
    processedImages: 0,
    failedImages: 0,
    files: filesState,
  }
}

/**
 * 从会话中获取迁移结果
 */
export function getResultsFromSession(session: MigrationSession): Map<string, FileMigrationResult> {
  const results = new Map<string, FileMigrationResult>()

  for (const [path, fileState] of Object.entries(session.files)) {
    const images: ImageMigrationResult[] = []

    for (const [url, imgState] of Object.entries(fileState.images)) {
      images.push({
        originalUrl: url,
        newUrl: imgState.newUrl,
        success: imgState.status === 'uploaded',
        error: imgState.error,
      })
    }

    results.set(path, {
      originalContent: fileState.originalContent,
      migratedContent: fileState.migratedContent,
      images,
      success: fileState.status === 'completed',
    })
  }

  return results
}

/**
 * 执行迁移会话（支持断点续传）
 */
export async function executeMigrationSession(
  session: MigrationSession,
  config: OSSConfig,
  controller: MigrationController,
  onProgress?: (session: MigrationSession) => void
): Promise<MigrationSession> {
  // 验证配置
  const validation = validateOSSConfig(config)
  if (!validation.valid) {
    session.status = 'failed'
    await saveMigrationSession(session)
    return session
  }

  // 创建 OSS 客户端
  const client = createOSSClient(config)

  session.status = 'running'

  // 遍历所有文件
  for (const [, fileState] of Object.entries(session.files)) {
    // 跳过已完成的文件
    if (fileState.status === 'completed') continue

    fileState.status = 'processing'

    // 遍历文件中的所有图片
    for (const [originalUrl, imgState] of Object.entries(fileState.images)) {
      // 检查是否停止
      if (controller.isStopped()) {
        session.status = 'paused'
        session.updatedAt = Date.now()
        await saveMigrationSession(session)
        return session
      }

      // 检查是否暂停，等待恢复
      const stopped = await waitIfPaused(controller)
      if (stopped) {
        session.status = 'paused'
        session.updatedAt = Date.now()
        await saveMigrationSession(session)
        return session
      }

      // 跳过已上传的图片
      if (imgState.status === 'uploaded') continue

      try {
        // 下载图片
        const blob = await downloadImageWithCache(originalUrl)
        imgState.status = 'downloaded'

        // 生成文件名
        const fileName = generateFileName(originalUrl, config.storagePath, blob.type)

        // 上传到 OSS
        const newUrl = await uploadToOSS(client, fileName, blob)
        imgState.status = 'uploaded'
        imgState.newUrl = newUrl

        // 替换内容中的 URL
        fileState.migratedContent = replaceImageUrl(
          fileState.migratedContent,
          originalUrl,
          newUrl
        )

        session.processedImages++
      } catch (error) {
        const err = error as Error
        imgState.status = 'failed'
        imgState.error = err.message
        session.failedImages++
        console.warn(`图片迁移失败: ${originalUrl}`, err.message)
      }

      // 更新会话时间戳并保存
      session.updatedAt = Date.now()
      await saveMigrationSession(session)
      onProgress?.(session)
    }

    // 检查文件是否完成
    const allDone = Object.values(fileState.images).every(
      img => img.status === 'uploaded' || img.status === 'failed'
    )
    if (allDone) {
      fileState.status = Object.values(fileState.images).some(img => img.status === 'failed')
        ? 'failed'
        : 'completed'
      session.processedFiles++
    }
  }

  // 检查整体是否完成
  const allFilesComplete = Object.values(session.files).every(
    f => f.status === 'completed' || f.status === 'failed'
  )
  session.status = allFilesComplete ? 'completed' : 'failed'
  session.updatedAt = Date.now()
  await saveMigrationSession(session)

  return session
}

/**
 * 开始新的迁移（始终创建新会话）
 */
export async function startMigration(
  files: Array<{ path: string; content: string }>,
  config: OSSConfig,
  controller: MigrationController,
  onProgress?: (session: MigrationSession) => void
): Promise<MigrationSession> {
  // 清除下载缓存
  clearImageCache()

  // 清除之前未完成的会话（如果有）
  const pendingSession = await getLatestPendingSession()
  if (pendingSession) {
    await deleteMigrationSession(pendingSession.id)
    console.log(`清除旧会话: ${pendingSession.id}`)
  }

  // 创建新会话
  const session = createMigrationSession(files)
  await saveMigrationSession(session)
  console.log(`创建新迁移会话: ${session.id}, 图片数: ${session.totalImages}`)

  // 如果没有图片需要迁移，直接返回完成状态
  if (session.totalImages === 0) {
    session.status = 'completed'
    await saveMigrationSession(session)
    return session
  }

  // 执行迁移
  return executeMigrationSession(session, config, controller, onProgress)
}

/**
 * 恢复未完成的迁移会话
 */
export async function resumeMigration(
  config: OSSConfig,
  controller: MigrationController,
  onProgress?: (session: MigrationSession) => void
): Promise<MigrationSession | null> {
  const pendingSession = await getLatestPendingSession()
  if (!pendingSession) {
    return null
  }

  console.log(`恢复迁移会话: ${pendingSession.id}`)
  clearImageCache()

  return executeMigrationSession(pendingSession, config, controller, onProgress)
}

/**
 * 重试失败的图片
 */
export async function retryFailedImages(
  session: MigrationSession,
  config: OSSConfig,
  controller: MigrationController,
  onProgress?: (session: MigrationSession) => void
): Promise<MigrationSession> {
  // 重置失败的图片状态
  for (const fileState of Object.values(session.files)) {
    for (const imgState of Object.values(fileState.images)) {
      if (imgState.status === 'failed') {
        imgState.status = 'pending'
        imgState.error = undefined
        session.failedImages--
      }
    }
    if (fileState.status === 'failed') {
      fileState.status = 'pending'
    }
  }

  session.status = 'running'
  session.updatedAt = Date.now()
  await saveMigrationSession(session)

  // 继续执行
  return executeMigrationSession(session, config, controller, onProgress)
}

/**
 * 取消迁移会话
 */
export async function cancelMigration(sessionId: string): Promise<void> {
  await deleteMigrationSession(sessionId)
  clearImageCache()
}

// ============ 保留原有简单接口用于单文件处理 ============

/**
 * 迁移单个文件的图片（简单版本，无断点续传）
 * @param content 文件内容
 * @param config OSS 配置
 * @param onProgress 进度回调
 */
export async function migrateFileImages(
  content: string,
  config: OSSConfig,
  onProgress?: ProgressCallback
): Promise<FileMigrationResult> {
  // 验证配置
  const validation = validateOSSConfig(config)
  if (!validation.valid) {
    return {
      originalContent: content,
      migratedContent: content,
      images: [],
      success: false,
    }
  }

  // 提取需要迁移的图片
  const imagesToMigrate = extractImagesToMigrate(content, 'aliyuncs.com')

  if (imagesToMigrate.length === 0) {
    return {
      originalContent: content,
      migratedContent: content,
      images: [],
      success: true,
    }
  }

  // 创建 OSS 客户端
  const client = createOSSClient(config)

  let migratedContent = content
  const results: ImageMigrationResult[] = []

  const progress: MigrationProgress = {
    total: imagesToMigrate.length,
    downloaded: 0,
    uploaded: 0,
    failed: 0,
  }

  // 逐个处理图片（顺序处理，不并行）
  for (const image of imagesToMigrate) {
    try {
      // 下载图片
      const blob = await downloadImageWithCache(image.url)
      progress.downloaded++
      onProgress?.(progress)

      // 生成文件名（传入 MIME 类型以保留原始格式）
      const fileName = generateFileName(image.url, config.storagePath, blob.type)

      // 上传到 OSS
      const newUrl = await uploadToOSS(client, fileName, blob)
      progress.uploaded++
      onProgress?.(progress)

      // 替换内容中的 URL
      migratedContent = replaceImageUrl(migratedContent, image.url, newUrl)

      results.push({
        originalUrl: image.url,
        newUrl,
        success: true,
      })
    } catch (error) {
      const err = error as Error
      progress.failed++
      onProgress?.(progress)

      // 失败时保留原始链接，不替换
      results.push({
        originalUrl: image.url,
        success: false,
        error: err.message,
      })
      console.warn(`图片迁移失败: ${image.url}`, err.message)
    }
  }

  return {
    originalContent: content,
    migratedContent,
    images: results,
    success: progress.failed === 0,
  }
}

/**
 * 批量迁移多个文件（简单版本，无断点续传）
 * 逐个文件处理，以兼容网络不稳定场景
 */
export async function migrateMultipleFiles(
  files: Array<{ path: string; content: string }>,
  config: OSSConfig,
  onFileProgress?: (filePath: string, progress: MigrationProgress) => void,
  onFileComplete?: (filePath: string, result: FileMigrationResult) => void
): Promise<Map<string, FileMigrationResult>> {
  const results = new Map<string, FileMigrationResult>()

  // 清除缓存，开始新的批量处理
  clearImageCache()

  for (const file of files) {
    const result = await migrateFileImages(file.content, config, (progress) => {
      onFileProgress?.(file.path, { ...progress, currentFile: file.path })
    })

    results.set(file.path, result)
    onFileComplete?.(file.path, result)
  }

  return results
}
