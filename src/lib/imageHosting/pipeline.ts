import { OSSConfig, MigrationProgress, MigrationSession, FileMigrationState, ImageMigrationState, getTargetDomain } from './types'
import { extractImagesToMigrate, extractAttachmentsToMigrate } from './detector'
import { createOSSClient, generateFileName, uploadToOSS, validateOSSConfig } from './ossClient'
import { downloadImageWithCache, clearImageCache } from './downloader'
import { saveMigrationSession, getLatestPendingSession, deleteMigrationSession } from '../storage'

/**
 * Single image migration result
 */
export interface ImageMigrationResult {
  originalUrl: string
  newUrl?: string
  success: boolean
  error?: string
}

/**
 * File migration result
 */
export interface FileMigrationResult {
  originalContent: string
  migratedContent: string
  images: ImageMigrationResult[]
  success: boolean
}

/**
 * Migration progress callback
 */
export type ProgressCallback = (progress: MigrationProgress) => void

/**
 * Migration controller (for pause/resume)
 */
export interface MigrationController {
  pause: () => void
  resume: () => void
  stop: () => void
  isPaused: () => boolean
  isStopped: () => boolean
}

/**
 * Create migration controller
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
 * Wait if paused
 */
async function waitIfPaused(controller: MigrationController): Promise<boolean> {
  while (controller.isPaused() && !controller.isStopped()) {
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return controller.isStopped()
}

/**
 * Replace image URL in content
 */
function replaceImageUrl(
  content: string,
  originalUrl: string,
  newUrl: string
): string {
  // Escape special characters for regex matching
  const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Replace markdown format: ![alt](url)
  const mdRegex = new RegExp(`(!\\[[^\\]]*\\])\\(${escapedUrl}(\\s*"[^"]*")?\\)`, 'g')
  content = content.replace(mdRegex, `$1(${newUrl}$2)`)

  // Replace HTML format: <img src="url">
  const htmlRegex = new RegExp(`(<img[^>]+src=["'])${escapedUrl}(["'][^>]*>)`, 'gi')
  content = content.replace(htmlRegex, `$1${newUrl}$2`)

  return content
}

/**
 * Replace attachment with markdown link
 * Handles:
 * - Roam format: {{[[pdf]]: url}} → [pdf](newUrl)
 * - Standalone URL: https://...file.pdf → [pdf](newUrl)
 * - List item URL: - https://...file.pdf → - [pdf](newUrl)
 */
function replaceAttachment(
  content: string,
  originalMatch: string,
  newUrl: string,
  attachmentType: string
): string {
  // Use attachment type as link text (e.g., "pdf", "docx")
  const linkText = attachmentType.toLowerCase()

  // Check if originalMatch is a Roam format or standalone URL
  const isRoamFormat = originalMatch.startsWith('{{')

  // Escape special characters for regex matching
  const escapedMatch = originalMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escapedMatch, 'g')

  if (isRoamFormat) {
    // Roam format: replace with markdown link
    return content.replace(regex, `[${linkText}](${newUrl})`)
  } else {
    // Standalone URL: check if it has list marker prefix
    const hasListMarker = originalMatch.trimStart().startsWith('-')
    if (hasListMarker) {
      // Preserve list marker
      const leadingWhitespace = originalMatch.match(/^(\s*)/)?.[1] || ''
      return content.replace(regex, `${leadingWhitespace}- [${linkText}](${newUrl})`)
    } else {
      // Just the URL
      return content.replace(regex, `[${linkText}](${newUrl})`)
    }
  }
}

/**
 * Generate session ID
 */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Create new migration session
 * @param files Files to process
 * @param config OSS config (used to determine target domain)
 */
export function createMigrationSession(
  files: Array<{ path: string; content: string }>,
  config: OSSConfig
): MigrationSession {
  const now = Date.now()
  let totalImages = 0
  const targetDomain = getTargetDomain(config)

  const filesState: Record<string, FileMigrationState> = {}

  for (const file of files) {
    const images = extractImagesToMigrate(file.content, targetDomain)
    const imagesState: Record<string, ImageMigrationState> = {}

    // Add images
    for (const img of images) {
      imagesState[img.url] = { status: 'pending' }
    }
    totalImages += images.length

    // Add attachments if enabled
    if (config.migrateAttachments) {
      const attachments = extractAttachmentsToMigrate(file.content, targetDomain)
      for (const att of attachments) {
        imagesState[att.url] = {
          status: 'pending',
          isAttachment: true,
          attachmentType: att.type,
          originalMatch: att.originalMatch,
        }
      }
      totalImages += attachments.length
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
 * Get migration results from session
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
 * Execute migration session (with breakpoint resumption and concurrent uploads)
 */
export async function executeMigrationSession(
  session: MigrationSession,
  config: OSSConfig,
  controller: MigrationController,
  onProgress?: (session: MigrationSession) => void,
  concurrency: number = 100 // Number of concurrent uploads
): Promise<MigrationSession> {
  // Validate config
  const validation = validateOSSConfig(config)
  if (!validation.valid) {
    session.status = 'failed'
    await saveMigrationSession(session)
    return session
  }

  // Create OSS client
  const client = createOSSClient(config)

  session.status = 'running'

  // Collect all pending images across all files
  const pendingTasks: Array<{
    fileState: FileMigrationState
    originalUrl: string
    imgState: ImageMigrationState
  }> = []

  for (const [, fileState] of Object.entries(session.files)) {
    if (fileState.status === 'completed') continue
    fileState.status = 'processing'

    for (const [originalUrl, imgState] of Object.entries(fileState.images)) {
      if (imgState.status !== 'uploaded') {
        pendingTasks.push({ fileState, originalUrl, imgState })
      }
    }
  }

  // Process images in concurrent batches
  let i = 0
  while (i < pendingTasks.length) {
    // Check if stopped
    if (controller.isStopped()) {
      session.status = 'paused'
      session.updatedAt = Date.now()
      await saveMigrationSession(session)
      return session
    }

    // Check if paused
    const stopped = await waitIfPaused(controller)
    if (stopped) {
      session.status = 'paused'
      session.updatedAt = Date.now()
      await saveMigrationSession(session)
      return session
    }

    // Get current batch
    const batch = pendingTasks.slice(i, i + concurrency)

    // Process batch concurrently
    await Promise.all(batch.map(async ({ fileState, originalUrl, imgState }) => {
      // Skip if already uploaded (in case of resume)
      if (imgState.status === 'uploaded') return

      try {
        // Download image/attachment
        const blob = await downloadImageWithCache(originalUrl)
        imgState.status = 'downloaded'

        // Generate filename
        const fileName = generateFileName(originalUrl, config.storagePath, blob.type)

        // Upload to OSS
        const newUrl = await uploadToOSS(client, fileName, blob)
        imgState.status = 'uploaded'
        imgState.newUrl = newUrl

        // Replace URL in content
        if (imgState.isAttachment && imgState.originalMatch) {
          // Attachment: replace entire Roam format with markdown link
          fileState.migratedContent = replaceAttachment(
            fileState.migratedContent,
            imgState.originalMatch,
            newUrl,
            imgState.attachmentType || 'file'
          )
        } else {
          // Image: replace URL only
          fileState.migratedContent = replaceImageUrl(
            fileState.migratedContent,
            originalUrl,
            newUrl
          )
        }

        session.processedImages++
      } catch (error) {
        const err = error as Error
        imgState.status = 'failed'
        imgState.error = err.message
        session.failedImages++
        console.warn(`${imgState.isAttachment ? 'Attachment' : 'Image'} migration failed: ${originalUrl}`, err.message)
      }
    }))

    // Update session after each batch
    session.updatedAt = Date.now()
    await saveMigrationSession(session)
    onProgress?.(session)

    i += concurrency
  }

  // Check file completion status
  for (const fileState of Object.values(session.files)) {
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

  // Check overall completion
  const allFilesComplete = Object.values(session.files).every(
    f => f.status === 'completed' || f.status === 'failed'
  )
  session.status = allFilesComplete ? 'completed' : 'failed'
  session.updatedAt = Date.now()
  await saveMigrationSession(session)

  return session
}

/**
 * Start new migration (always create new session)
 */
export async function startMigration(
  files: Array<{ path: string; content: string }>,
  config: OSSConfig,
  controller: MigrationController,
  onProgress?: (session: MigrationSession) => void
): Promise<MigrationSession> {
  // Clear download cache
  clearImageCache()

  // Clear previous pending session if any
  const pendingSession = await getLatestPendingSession()
  if (pendingSession) {
    await deleteMigrationSession(pendingSession.id)
    console.log(`Cleared old session: ${pendingSession.id}`)
  }

  // Create new session with config (determines target domain and attachment migration)
  const session = createMigrationSession(files, config)
  await saveMigrationSession(session)
  console.log(`Created new migration session: ${session.id}, items: ${session.totalImages}`)

  // If no images to migrate, return completed status
  if (session.totalImages === 0) {
    session.status = 'completed'
    await saveMigrationSession(session)
    return session
  }

  // Execute migration
  return executeMigrationSession(session, config, controller, onProgress)
}

/**
 * Resume pending migration session
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

  console.log(`Resuming migration session: ${pendingSession.id}`)
  clearImageCache()

  return executeMigrationSession(pendingSession, config, controller, onProgress)
}

/**
 * Retry failed images
 */
export async function retryFailedImages(
  session: MigrationSession,
  config: OSSConfig,
  controller: MigrationController,
  onProgress?: (session: MigrationSession) => void
): Promise<MigrationSession> {
  // Reset failed image status
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

  // Continue execution
  return executeMigrationSession(session, config, controller, onProgress)
}

/**
 * Cancel migration session
 */
export async function cancelMigration(sessionId: string): Promise<void> {
  await deleteMigrationSession(sessionId)
  clearImageCache()
}

// ============ Legacy simple interface for single file processing ============

/**
 * Migrate images in a single file (simple version, no breakpoint resumption)
 * @param content File content
 * @param config OSS config
 * @param onProgress Progress callback
 */
export async function migrateFileImages(
  content: string,
  config: OSSConfig,
  onProgress?: ProgressCallback
): Promise<FileMigrationResult> {
  // Validate config
  const validation = validateOSSConfig(config)
  if (!validation.valid) {
    return {
      originalContent: content,
      migratedContent: content,
      images: [],
      success: false,
    }
  }

  // Extract images to migrate (use target domain from config)
  const targetDomain = getTargetDomain(config)
  const imagesToMigrate = extractImagesToMigrate(content, targetDomain)

  if (imagesToMigrate.length === 0) {
    return {
      originalContent: content,
      migratedContent: content,
      images: [],
      success: true,
    }
  }

  // Create OSS client
  const client = createOSSClient(config)

  let migratedContent = content
  const results: ImageMigrationResult[] = []

  const progress: MigrationProgress = {
    total: imagesToMigrate.length,
    downloaded: 0,
    uploaded: 0,
    failed: 0,
  }

  // Process images concurrently (batch of 100)
  const concurrency = 100
  for (let i = 0; i < imagesToMigrate.length; i += concurrency) {
    const batch = imagesToMigrate.slice(i, i + concurrency)

    await Promise.all(batch.map(async (image) => {
      try {
        // Download image
        const blob = await downloadImageWithCache(image.url)
        progress.downloaded++
        onProgress?.(progress)

        // Generate filename (pass MIME type to preserve original format)
        const fileName = generateFileName(image.url, config.storagePath, blob.type)

        // Upload to OSS
        const newUrl = await uploadToOSS(client, fileName, blob)
        progress.uploaded++
        onProgress?.(progress)

        // Replace URL in content
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

        // Keep original link on failure
        results.push({
          originalUrl: image.url,
          success: false,
          error: err.message,
        })
        console.warn(`Image migration failed: ${image.url}`, err.message)
      }
    }))
  }

  return {
    originalContent: content,
    migratedContent,
    images: results,
    success: progress.failed === 0,
  }
}

/**
 * Batch migrate multiple files (simple version, no breakpoint resumption)
 * Process files one by one for network stability
 */
export async function migrateMultipleFiles(
  files: Array<{ path: string; content: string }>,
  config: OSSConfig,
  onFileProgress?: (filePath: string, progress: MigrationProgress) => void,
  onFileComplete?: (filePath: string, result: FileMigrationResult) => void
): Promise<Map<string, FileMigrationResult>> {
  const results = new Map<string, FileMigrationResult>()

  // Clear cache for new batch processing
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
