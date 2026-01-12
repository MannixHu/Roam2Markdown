import { Form, Input, Switch } from 'antd'
import { OSSConfig, getTargetDomain } from '../lib/imageHosting/types'

interface ImageHostingConfigProps {
  config: OSSConfig
  onChange: (config: OSSConfig) => void
}

export default function ImageHostingConfig({ config, onChange }: ImageHostingConfigProps) {
  const handleToggle = (enabled: boolean) => {
    onChange({ ...config, enabled })
  }

  const handleFieldChange = (field: keyof OSSConfig, value: string) => {
    onChange({ ...config, [field]: value })
  }

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div className="flex items-center justify-between p-3 bg-white border border-neutral-200 rounded">
        <div>
          <div className="text-sm font-medium text-neutral-700">Image Hosting Migration</div>
          <div className="text-xs text-neutral-400 mt-0.5">
            Auto-migrate external images to Aliyun OSS
          </div>
        </div>
        <Switch checked={config.enabled} onChange={handleToggle} />
      </div>

      {/* Config form */}
      {config.enabled && (
        <div className="card p-4 space-y-3">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">
            Aliyun OSS Configuration
          </div>

          <Form layout="vertical" size="small">
            <Form.Item
              label="Access Key ID"
              required
              className="mb-3"
            >
              <Input
                placeholder="Enter Access Key ID"
                value={config.accessKeyId}
                onChange={(e) => handleFieldChange('accessKeyId', e.target.value)}
              />
            </Form.Item>

            <Form.Item
              label="Access Key Secret"
              required
              className="mb-3"
            >
              <Input.Password
                placeholder="Enter Access Key Secret"
                value={config.accessKeySecret}
                onChange={(e) => handleFieldChange('accessKeySecret', e.target.value)}
              />
            </Form.Item>

            <Form.Item
              label="Bucket Name"
              required
              className="mb-3"
            >
              <Input
                placeholder="e.g. my-bucket"
                value={config.bucket}
                onChange={(e) => handleFieldChange('bucket', e.target.value)}
              />
            </Form.Item>

            <Form.Item
              label="Region"
              required
              className="mb-3"
              extra="e.g. oss-cn-hangzhou, oss-cn-shanghai"
            >
              <Input
                placeholder="e.g. oss-cn-hangzhou"
                value={config.region}
                onChange={(e) => handleFieldChange('region', e.target.value)}
              />
            </Form.Item>

            <Form.Item
              label="Storage Path"
              className="mb-3"
              extra="Optional, e.g. images/ or blog/assets/"
            >
              <Input
                placeholder="e.g. images/"
                value={config.storagePath}
                onChange={(e) => handleFieldChange('storagePath', e.target.value)}
              />
            </Form.Item>

            <Form.Item
              className="mb-0"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-neutral-700">Migrate Attachments</div>
                  <div className="text-xs text-neutral-400">
                    Also migrate PDF, DOC, audio, video files
                  </div>
                </div>
                <Switch
                  checked={config.migrateAttachments ?? false}
                  onChange={(checked) => onChange({ ...config, migrateAttachments: checked })}
                />
              </div>
            </Form.Item>
          </Form>

          <div className="pt-2 mt-2 border-t border-neutral-100">
            <div className="text-xs text-neutral-400 space-y-2">
              <p>Images not from <code className="bg-neutral-100 px-1 text-neutral-500">{getTargetDomain(config)}</code> will be migrated</p>
              <details className="cursor-pointer">
                <summary className="text-orange-600 hover:text-orange-700">First time? Configure OSS CORS settings</summary>
                <div className="mt-2 ml-2 p-2 bg-neutral-50 rounded text-neutral-600">
                  <p className="mb-1">In OSS Console → Permission → CORS Settings:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>Origin: <code className="bg-neutral-200 px-1">*</code></li>
                    <li>Allowed Methods: <code className="bg-neutral-200 px-1">GET, PUT, POST</code></li>
                    <li>Allowed Headers: <code className="bg-neutral-200 px-1">*</code></li>
                    <li>Expose Headers: <code className="bg-neutral-200 px-1">ETag</code></li>
                  </ul>
                </div>
              </details>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
