// 类型导出
export * from './types'

// 检测器
export { detectImageLinks, extractImagesToMigrate, isRemoteImage, isFromImageHost } from './detector'

// OSS 客户端
export { createOSSClient, validateOSSConfig, uploadToOSS, generateFileName, generateCDNUrl } from './ossClient'

// 下载器
export { downloadImage, downloadImageWithCache, clearImageCache } from './downloader'

// 迁移流程
export { migrateFileImages, migrateMultipleFiles, startMigration, resumeMigration, retryFailedImages, cancelMigration, createMigrationController, getResultsFromSession } from './pipeline'
export type { ImageMigrationResult, FileMigrationResult, ProgressCallback, MigrationController } from './pipeline'
