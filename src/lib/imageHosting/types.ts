// Aliyun OSS configuration
export interface OSSConfig {
  enabled: boolean
  accessKeyId: string
  accessKeySecret: string
  bucket: string
  region: string
  storagePath?: string // Optional storage path prefix
  migrateAttachments?: boolean // Also migrate attachments (pdf, audio, etc.)
}

/**
 * Get target domain from OSS config
 * e.g. bucket=mannix-imgurl, region=oss-cn-beijing → mannix-imgurl.oss-cn-beijing.aliyuncs.com
 */
export function getTargetDomain(config: OSSConfig): string {
  if (config.bucket && config.region) {
    return `${config.bucket}.${config.region}.aliyuncs.com`
  }
  return 'aliyuncs.com' // fallback
}

// OSS region options
export const OSS_REGIONS = [
  { label: 'China East 1 (Hangzhou)', value: 'oss-cn-hangzhou' },
  { label: 'China East 2 (Shanghai)', value: 'oss-cn-shanghai' },
  { label: 'China North 1 (Qingdao)', value: 'oss-cn-qingdao' },
  { label: 'China North 2 (Beijing)', value: 'oss-cn-beijing' },
  { label: 'China North 3 (Zhangjiakou)', value: 'oss-cn-zhangjiakou' },
  { label: 'China South 1 (Shenzhen)', value: 'oss-cn-shenzhen' },
  { label: 'China South 2 (Heyuan)', value: 'oss-cn-heyuan' },
  { label: 'China South 3 (Guangzhou)', value: 'oss-cn-guangzhou' },
  { label: 'China Southwest 1 (Chengdu)', value: 'oss-cn-chengdu' },
  { label: 'China (Hong Kong)', value: 'oss-cn-hongkong' },
  { label: 'US West 1 (Silicon Valley)', value: 'oss-us-west-1' },
  { label: 'US East 1 (Virginia)', value: 'oss-us-east-1' },
  { label: 'Asia Pacific SE 1 (Singapore)', value: 'oss-ap-southeast-1' },
  { label: 'Asia Pacific SE 2 (Sydney)', value: 'oss-ap-southeast-2' },
  { label: 'Asia Pacific SE 3 (Kuala Lumpur)', value: 'oss-ap-southeast-3' },
  { label: 'Asia Pacific SE 5 (Jakarta)', value: 'oss-ap-southeast-5' },
  { label: 'Asia Pacific NE 1 (Tokyo)', value: 'oss-ap-northeast-1' },
  { label: 'Asia Pacific South 1 (Mumbai)', value: 'oss-ap-south-1' },
  { label: 'EU Central 1 (Frankfurt)', value: 'oss-eu-central-1' },
  { label: 'UK (London)', value: 'oss-eu-west-1' },
  { label: 'Middle East 1 (Dubai)', value: 'oss-me-east-1' },
]

// Image info
export interface ImageInfo {
  url: string
  altText?: string
  title?: string
}

// Attachment info (pdf, audio, video, etc.)
export interface AttachmentInfo {
  url: string
  type: string // pdf, audio, video, etc.
  originalMatch: string // Original match string for replacement
}

// Migration progress
export interface MigrationProgress {
  total: number
  downloaded: number
  uploaded: number
  failed: number
  currentFile?: string
}

// Single image/attachment migration state
export interface ImageMigrationState {
  status: 'pending' | 'downloaded' | 'uploaded' | 'failed'
  newUrl?: string
  error?: string
  // Attachment-specific fields
  isAttachment?: boolean
  attachmentType?: string // pdf, audio, video, etc.
  originalMatch?: string // Original match string for replacement
}

// Single file migration state
export interface FileMigrationState {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  originalContent: string
  migratedContent: string
  images: Record<string, ImageMigrationState> // key is original URL
}

// Migration session (for breakpoint resumption)
export interface MigrationSession {
  id: string
  startedAt: number
  updatedAt: number
  status: 'running' | 'paused' | 'completed' | 'failed'
  totalFiles: number
  totalImages: number
  processedFiles: number
  processedImages: number
  failedImages: number
  files: Record<string, FileMigrationState> // key is file path
}
