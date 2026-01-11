// 阿里云 OSS 配置
export interface OSSConfig {
  enabled: boolean
  accessKeyId: string
  accessKeySecret: string
  bucket: string
  region: string
  storagePath?: string // 可选的存储路径前缀
}

// OSS 区域选项
export const OSS_REGIONS = [
  { label: '华东 1（杭州）', value: 'oss-cn-hangzhou' },
  { label: '华东 2（上海）', value: 'oss-cn-shanghai' },
  { label: '华北 1（青岛）', value: 'oss-cn-qingdao' },
  { label: '华北 2（北京）', value: 'oss-cn-beijing' },
  { label: '华北 3（张家口）', value: 'oss-cn-zhangjiakou' },
  { label: '华南 1（深圳）', value: 'oss-cn-shenzhen' },
  { label: '华南 2（河源）', value: 'oss-cn-heyuan' },
  { label: '华南 3（广州）', value: 'oss-cn-guangzhou' },
  { label: '西南 1（成都）', value: 'oss-cn-chengdu' },
  { label: '中国（香港）', value: 'oss-cn-hongkong' },
  { label: '美国西部 1（硅谷）', value: 'oss-us-west-1' },
  { label: '美国东部 1（弗吉尼亚）', value: 'oss-us-east-1' },
  { label: '亚太东南 1（新加坡）', value: 'oss-ap-southeast-1' },
  { label: '亚太东南 2（悉尼）', value: 'oss-ap-southeast-2' },
  { label: '亚太东南 3（吉隆坡）', value: 'oss-ap-southeast-3' },
  { label: '亚太东南 5（雅加达）', value: 'oss-ap-southeast-5' },
  { label: '亚太东北 1（东京）', value: 'oss-ap-northeast-1' },
  { label: '亚太南部 1（孟买）', value: 'oss-ap-south-1' },
  { label: '欧洲中部 1（法兰克福）', value: 'oss-eu-central-1' },
  { label: '英国（伦敦）', value: 'oss-eu-west-1' },
  { label: '中东东部 1（迪拜）', value: 'oss-me-east-1' },
]

// 图片信息
export interface ImageInfo {
  url: string
  altText?: string
  title?: string
}

// 迁移进度
export interface MigrationProgress {
  total: number
  downloaded: number
  uploaded: number
  failed: number
  currentFile?: string
}

// 单张图片的迁移状态
export interface ImageMigrationState {
  status: 'pending' | 'downloaded' | 'uploaded' | 'failed'
  newUrl?: string
  error?: string
}

// 单个文件的迁移状态
export interface FileMigrationState {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  originalContent: string
  migratedContent: string
  images: Record<string, ImageMigrationState> // key 是原始 URL
}

// 迁移会话（用于断点续传）
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
  files: Record<string, FileMigrationState> // key 是文件路径
}
