import { Progress, Button, Space, Tag } from 'antd'
import { PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { MigrationSession } from '../lib/imageHosting/types'
import { MigrationController } from '../lib/imageHosting/pipeline'

interface MigrationProgressProps {
  session: MigrationSession
  controller: MigrationController
  onRetry: () => void
  onCancel: () => void
}

export default function MigrationProgress({
  session,
  controller,
  onRetry,
  onCancel,
}: MigrationProgressProps) {
  const { totalImages, processedImages, failedImages, status } = session

  // Calculate progress percentage
  const percent = totalImages > 0
    ? Math.round(((processedImages + failedImages) / totalImages) * 100)
    : 0

  // Determine progress bar status
  const progressStatus = status === 'completed'
    ? 'success'
    : status === 'failed' || failedImages > 0
      ? 'exception'
      : 'active'

  // Status label
  const statusLabel = {
    running: { color: 'processing', text: 'Migrating' },
    paused: { color: 'warning', text: 'Paused' },
    completed: { color: 'success', text: 'Completed' },
    failed: { color: 'error', text: 'Failed' },
  }[status]

  const isPaused = controller.isPaused()
  const isRunning = status === 'running' && !isPaused
  const canRetry = failedImages > 0 && (status === 'completed' || status === 'failed')

  return (
    <div className="p-3 bg-neutral-50 border border-neutral-200 rounded space-y-3">
      {/* Title and status */}
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-neutral-700">
          Image Migration Progress
        </div>
        <Tag color={statusLabel.color}>{statusLabel.text}</Tag>
      </div>

      {/* Progress bar */}
      <Progress
        percent={percent}
        status={progressStatus}
        size="small"
        format={() => `${processedImages + failedImages}/${totalImages}`}
      />

      {/* Stats */}
      <div className="text-xs text-neutral-500 flex gap-4">
        <span>Total: {totalImages}</span>
        <span className="text-green-600">Success: {processedImages}</span>
        {failedImages > 0 && (
          <span className="text-red-500">Failed: {failedImages}</span>
        )}
      </div>

      {/* Control buttons */}
      <div className="flex gap-2 pt-1">
        <Space size="small">
          {isRunning && (
            <Button
              size="small"
              icon={<PauseCircleOutlined />}
              onClick={() => controller.pause()}
            >
              Pause
            </Button>
          )}

          {isPaused && status === 'running' && (
            <Button
              size="small"
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => controller.resume()}
            >
              Resume
            </Button>
          )}

          {canRetry && (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={onRetry}
            >
              Retry Failed ({failedImages})
            </Button>
          )}

          {status !== 'completed' && (
            <Button
              size="small"
              danger
              icon={<CloseCircleOutlined />}
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
        </Space>
      </div>

      {/* Resume hint */}
      {(status === 'paused' || isPaused) && (
        <div className="text-xs text-orange-600 bg-orange-50 p-2 rounded">
          Migration paused. You can resume progress after refreshing the page.
        </div>
      )}
    </div>
  )
}
