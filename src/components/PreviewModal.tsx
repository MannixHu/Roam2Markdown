import { Modal } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { FileItem } from '../lib/transformer'
import { useSyncScroll } from '../hooks/useSyncScroll'

interface PreviewModalProps {
  open: boolean
  file: FileItem | null
  files: FileItem[]
  onClose: () => void
  onFileChange: (file: FileItem) => void
}

export default function PreviewModal({
  open,
  file,
  files,
  onClose,
  onFileChange,
}: PreviewModalProps) {
  const { leftRef, rightRef, onScrollLeft, onScrollRight } = useSyncScroll()

  if (!file) return null

  const changedFiles = files.filter((f) => f.changes.length > 0)

  return (
    <Modal
      title="preview"
      open={open}
      onCancel={onClose}
      width={1400}
      footer={null}
    >
      <div className="flex gap-4" style={{ height: '75vh' }}>
        {/* File List */}
        <div className="w-64 border-r border-neutral-200 pr-4 overflow-auto">
          <div className="space-y-1">
            {changedFiles.map((f) => (
              <button
                key={f.originalPath}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  file.originalPath === f.originalPath
                    ? 'bg-neutral-900 text-white'
                    : 'hover:bg-neutral-100'
                }`}
                onClick={() => onFileChange(f)}
              >
                <div className="font-medium truncate">{f.newName}</div>
                <div className="text-xs opacity-60">{f.changes.length} changes</div>
              </button>
            ))}
          </div>
        </div>

        {/* Preview Content */}
        <div className="flex-1 grid grid-cols-2 gap-4">
          {/* Before */}
          <div className="border border-neutral-200 rounded overflow-hidden flex flex-col">
            <div className="bg-neutral-100 px-3 py-2 text-xs text-neutral-600 font-medium border-b border-neutral-200">
              before
            </div>
            <div
              ref={leftRef}
              onScroll={onScrollLeft}
              className="flex-1 overflow-auto p-4 markdown-body"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {file.content}
              </ReactMarkdown>
            </div>
          </div>

          {/* After */}
          <div className="border border-neutral-200 rounded overflow-hidden flex flex-col">
            <div className="bg-neutral-100 px-3 py-2 text-xs text-neutral-600 font-medium border-b border-neutral-200">
              after
            </div>
            <div
              ref={rightRef}
              onScroll={onScrollRight}
              className="flex-1 overflow-auto p-4 markdown-body"
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                {file.transformedContent}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
