// Type exports
export * from './types'

// Detector
export { detectImageLinks, extractImagesToMigrate, isRemoteImage, isFromImageHost, detectAttachmentLinks, extractAttachmentsToMigrate } from './detector'

// OSS client
export { createOSSClient, validateOSSConfig, uploadToOSS, generateFileName, generateCDNUrl } from './ossClient'

// Downloader
export { downloadImage, downloadImageWithCache, clearImageCache } from './downloader'

// Migration pipeline
export { migrateFileImages, migrateMultipleFiles, startMigration, resumeMigration, retryFailedImages, cancelMigration, createMigrationController, getResultsFromSession } from './pipeline'
export type { ImageMigrationResult, FileMigrationResult, ProgressCallback, MigrationController } from './pipeline'
