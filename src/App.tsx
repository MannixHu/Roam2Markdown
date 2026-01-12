import { useState, useEffect, useRef } from 'react'
import {
  Upload,
  Switch,
  Button,
  message,
  Modal,
  Input,
  Form,
  Tabs,
  Drawer,
  Table,
  Radio,
} from 'antd'
import {
  FolderOpenOutlined,
  SettingOutlined,
  DownloadOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
import type { UploadFile } from 'antd'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { builtInRules, TransformRule, DateSeparator } from './lib/rules'
import { processFile, FileItem } from './lib/transformer'
import PreviewModal from './components/PreviewModal'
import ImageHostingConfig from './components/ImageHostingConfig'
import MigrationProgressComponent from './components/MigrationProgress'
import { OSSConfig, MigrationSession } from './lib/imageHosting/types'
import { validateOSSConfig } from './lib/imageHosting/ossClient'
import {
  startMigration,
  getResultsFromSession,
  createMigrationController,
  MigrationController,
  retryFailedImages,
  cancelMigration,
} from './lib/imageHosting/pipeline'
import { saveAppConfig, loadAppConfig } from './lib/storage'

const { Dragger } = Upload

export default function App() {
  const [rules, setRules] = useState<TransformRule[]>(builtInRules)
  const [customRules, setCustomRules] = useState<TransformRule[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [form] = Form.useForm()
  const [ossConfig, setOssConfig] = useState<OSSConfig>({
    enabled: false,
    accessKeyId: '',
    accessKeySecret: '',
    bucket: '',
    region: 'oss-cn-hangzhou',
    storagePath: '',
  })
  const [processing, setProcessing] = useState(false)
  const [migrationSession, setMigrationSession] = useState<MigrationSession | null>(null)
  const controllerRef = useRef<MigrationController | null>(null)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<Array<{ path: string; content: string }>>([])
  const [downloadCount, setDownloadCount] = useState(0)
  const [originalZipName, setOriginalZipName] = useState<string>('')
  const [rawFiles, setRawFiles] = useState<Array<{ path: string; content: string }>>([]) // 上传但未转换的文件
  // 加载保存的配置
  useEffect(() => {
    loadAppConfig().then((saved) => {
      if (saved) {
        setOssConfig(saved.ossConfig)
        setCustomRules(saved.customRules || [])
        // 恢复内置规则的启用状态和选项
        setRules(prev => prev.map(r => ({
          ...r,
          enabled: saved.disabledRuleIds ? !saved.disabledRuleIds.includes(r.id) : r.enabled,
          options: saved.ruleOptions?.[r.id] || r.options,
        })))
      }
      setConfigLoaded(true)
    })
  }, [])

  // 配置变更时保存（等待初始加载完成后）
  useEffect(() => {
    if (!configLoaded) return
    const disabledRuleIds = rules.filter(r => !r.enabled).map(r => r.id)
    const ruleOptions: Record<string, TransformRule['options']> = {}
    rules.forEach(r => {
      if (r.options) ruleOptions[r.id] = r.options
    })
    saveAppConfig({ ossConfig, customRules, disabledRuleIds, ruleOptions })
  }, [ossConfig, customRules, rules, configLoaded])

  const allRules = [...rules, ...customRules]
  const enabledCount = allRules.filter((r) => r.enabled).length

  const toggleRule = (id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    )
    setCustomRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    )
  }

  const updateRuleOptions = (id: string, options: TransformRule['options']) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, options: { ...r.options, ...options } } : r))
    )
  }

  // 加载文件（只读取，不转换）
  const loadFiles = async (fileList: (UploadFile | File)[]) => {
    const filesToLoad: Array<{ path: string; content: string }> = []

    for (const item of fileList) {
      const file = 'originFileObj' in item ? item.originFileObj : item
      const name = 'originFileObj' in item ? item.name : item.name

      if (!file || !(file instanceof File)) continue

      // 处理 zip 文件
      if (name.endsWith('.zip')) {
        // 保存原始 zip 文件名（去掉 .zip 后缀）
        setOriginalZipName(name.replace(/\.zip$/i, ''))
        try {
          const zip = await JSZip.loadAsync(file as File)
          const entries = Object.entries(zip.files)

          for (const [path, zipEntry] of entries) {
            // 跳过目录、macOS 元数据文件
            if (zipEntry.dir) continue
            if (path.startsWith('__MACOSX/')) continue
            if (path.includes('/._') || path.startsWith('._')) continue
            if (!path.endsWith('.md')) continue

            const content = await zipEntry.async('string')
            filesToLoad.push({ path, content })
          }
        } catch {
          message.error('failed to read zip file')
          return
        }
      }
      // 处理 md 文件
      else if (name.endsWith('.md')) {
        const content = await file.text()
        filesToLoad.push({ path: name, content })
      }
    }

    if (filesToLoad.length > 0) {
      setRawFiles(filesToLoad)
      setFiles([]) // 清空已转换的文件
      setMigrationSession(null)
      message.success(`${filesToLoad.length} files loaded, click "Start Conversion"`)
    }
  }

  // 开始转换
  const startConversion = async () => {
    if (rawFiles.length === 0) {
      message.warning('No files to convert')
      return
    }

    setProcessing(true)
    setMigrationSession(null)
    const filesToProcess = rawFiles

    // 检查图床配置
    const shouldMigrateImages = ossConfig.enabled && validateOSSConfig(ossConfig).valid

    // 如果需要图床迁移，使用会话机制
    if (shouldMigrateImages && filesToProcess.length > 0) {
      setPendingFiles(filesToProcess)
      const controller = createMigrationController()
      controllerRef.current = controller

      try {
        const session = await startMigration(
          filesToProcess,
          ossConfig,
          controller,
          (updatedSession) => setMigrationSession({ ...updatedSession })
        )
        setMigrationSession(session)

        // 迁移完成后处理文件
        if (session.status === 'completed' || session.status === 'failed') {
          const results = getResultsFromSession(session)
          const processed: FileItem[] = []

          for (const file of filesToProcess) {
            const result = results.get(file.path)
            const finalContent = result?.migratedContent || file.content
            processed.push(processFile(file.path, finalContent, allRules))
          }

          setFiles(processed)
          setProcessing(false)

          if (session.failedImages > 0) {
            message.warning(`Done. ${session.failedImages} images failed, click retry`)
          } else {
            message.success(`Done. ${processed.length} files processed`)
          }
        }
      } catch (err) {
        console.error('Migration failed:', err)
        message.error('Image migration failed')
        setProcessing(false)
      }
    } else {
      // 不需要图床迁移，直接处理
      const processed: FileItem[] = []
      for (const file of filesToProcess) {
        processed.push(processFile(file.path, file.content, allRules))
      }

      setFiles(processed)
      setProcessing(false)

      if (processed.length > 0) {
        message.success(`done. ${processed.length} files processed.`)
      }
    }
  }

  // 重试失败的图片
  const handleRetryFailed = async () => {
    if (!migrationSession || !pendingFiles.length) return

    setProcessing(true)
    const controller = createMigrationController()
    controllerRef.current = controller

    try {
      const session = await retryFailedImages(
        migrationSession,
        ossConfig,
        controller,
        (updatedSession) => setMigrationSession({ ...updatedSession })
      )
      setMigrationSession(session)

      // 重试完成后更新文件
      if (session.status === 'completed' || session.status === 'failed') {
        const results = getResultsFromSession(session)
        const processed: FileItem[] = []

        for (const file of pendingFiles) {
          const result = results.get(file.path)
          const finalContent = result?.migratedContent || file.content
          processed.push(processFile(file.path, finalContent, allRules))
        }

        setFiles(processed)
        setProcessing(false)

        if (session.failedImages > 0) {
          message.warning(`Still ${session.failedImages} images failed`)
        } else {
          message.success('All images migrated successfully')
        }
      }
    } catch (err) {
      console.error('Retry failed:', err)
      setProcessing(false)
    }
  }

  // 取消迁移
  const handleCancelMigration = async () => {
    if (controllerRef.current) {
      controllerRef.current.stop()
    }

    if (migrationSession) {
      await cancelMigration(migrationSession.id)
    }

    setMigrationSession(null)
    setProcessing(false)
    setPendingFiles([])
    message.info('Migration cancelled')
  }

  const handleUpload = async (fileList: UploadFile[]) => {
    await loadFiles(fileList)
  }

  // 全局拖拽处理
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const droppedFiles = Array.from(e.dataTransfer.files)
    const validFiles = droppedFiles.filter(
      (f) => f.name.endsWith('.md') || f.name.endsWith('.zip')
    )

    if (validFiles.length > 0) {
      await loadFiles(validFiles)
    } else {
      message.warning('only .md and .zip files supported')
    }
  }

  const download = async () => {
    // 单个文件直接下载 md
    if (files.length === 1) {
      const file = files[0]
      const blob = new Blob([file.transformedContent], { type: 'text/markdown' })
      saveAs(blob, file.newName)
    }
    // 多个文件打包 zip（包含 journals/ 和 pages/ 文件夹结构）
    else {
      const zip = new JSZip()
      files.forEach((file) => {
        // 使用 newPath 创建文件夹结构
        zip.file(file.newPath, file.transformedContent)
      })
      const blob = await zip.generateAsync({ type: 'blob' })
      const newCount = downloadCount + 1
      setDownloadCount(newCount)
      const baseName = originalZipName || 'roam-to-obsidian'
      saveAs(blob, `${baseName}_${newCount}.zip`)
    }
  }

  const addCustomRule = () => {
    form.validateFields().then((values) => {
      try {
        const pattern = new RegExp(values.pattern, 'g')
        const newRule: TransformRule = {
          id: `custom-${Date.now()}`,
          name: values.name,
          description: `${values.pattern} → ${values.replacement}`,
          enabled: true,
          transform: (content) => content.replace(pattern, values.replacement),
        }
        setCustomRules((prev) => [...prev, newRule])
        setModalOpen(false)
        form.resetFields()
        message.success('rule added')
      } catch {
        message.error('invalid regex')
      }
    })
  }

  const changedCount = files.filter((f) => f.changes.length > 0).length

  return (
    <div
      className="min-h-screen flex flex-col p-3 relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <header className="px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold tracking-tight text-neutral-700">
            Roam2Markdown
          </span>
          <span className="text-xs text-neutral-400 hidden sm:inline">
            migration tool for Obsidian & more
          </span>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
        >
          <SettingOutlined />
          <span>rules ({enabledCount})</span>
        </button>
      </header>

      {/* Main */}
      <main className="flex-1 flex px-6 py-8 gap-8">
        {/* Left: Upload/Results Area */}
        <div className="flex-1 flex flex-col items-center justify-center">
        {processing ? (
          <div className="w-full max-w-md text-center">
            <div className="card p-8">
              <div className="w-12 h-12 bg-neutral-900 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
                <svg className="w-6 h-6 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
              <p className="text-neutral-800 font-medium mb-1">
                processing...
              </p>
              {migrationSession && controllerRef.current && (
                <div className="mt-4">
                  <MigrationProgressComponent
                    session={migrationSession}
                    controller={controllerRef.current}
                    onRetry={handleRetryFailed}
                    onCancel={handleCancelMigration}
                  />
                </div>
              )}
            </div>
          </div>
        ) : rawFiles.length > 0 && files.length === 0 ? (
          // 文件已加载，等待转换
          <div className="w-full max-w-md text-center">
            <div className="card p-8">
              <div className="w-12 h-12 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <FolderOpenOutlined className="text-2xl text-neutral-600" />
              </div>
              <p className="text-neutral-800 font-medium mb-1">
                {rawFiles.length} files loaded
              </p>
              <p className="text-sm text-neutral-500 mb-6">
                ready to convert
              </p>
              <div className="flex flex-col gap-3">
                <Button
                  type="primary"
                  size="large"
                  onClick={startConversion}
                  block
                >
                  Start Conversion
                </Button>
                <button
                  onClick={() => setRawFiles([])}
                  className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
                >
                  clear files
                </button>
              </div>
            </div>
          </div>
        ) : files.length === 0 ? (
          <div className="w-full max-w-md">
            <div className="card p-6">
              <Dragger
                multiple
                showUploadList={false}
                beforeUpload={() => false}
                onChange={(info) => handleUpload(info.fileList)}
                accept=".md,.zip"
              >
                <div className="py-12 text-center">
                  <FolderOpenOutlined className="text-4xl text-neutral-400 mb-4" />
                  <p className="text-neutral-700 mb-1">
                    select or drop files
                  </p>
                  <p className="text-xs text-neutral-400">
                    .md or .zip files
                  </p>
                </div>
              </Dragger>
            </div>
            <p className="text-center text-xs text-neutral-400 mt-4">
              configure rules before conversion
            </p>
          </div>
        ) : (
          <div className="w-full max-w-md text-center">
            <div className="card p-8">
              <div className="w-12 h-12 bg-neutral-900 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-neutral-800 font-medium mb-1">
                {files.length} files processed
              </p>
              <p className="text-sm text-neutral-500 mb-8">
                {changedCount} modified
              </p>
              <div className="flex flex-col gap-3">
                <Button
                  type="primary"
                  size="large"
                  icon={<DownloadOutlined />}
                  onClick={download}
                  block
                >
                  download {files.length === 1 ? '.md' : '.zip'}
                </Button>
                {changedCount > 0 && (
                  <Button
                    size="large"
                    onClick={() => setPreviewFile(files.find((f) => f.changes.length > 0) || null)}
                    block
                  >
                    preview changes
                  </Button>
                )}
                <button
                  onClick={() => { setFiles([]); setRawFiles([]) }}
                  className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
                >
                  start over
                </button>
              </div>
            </div>

            {changedCount > 0 && (
              <details className="card mt-6 text-left">
                <summary className="cursor-pointer px-4 py-3 text-sm text-neutral-600 hover:bg-neutral-50">
                  view changes ({changedCount})
                </summary>
                <div className="px-4 pb-4 max-h-64 overflow-auto">
                  <Table
                    dataSource={files.filter((f) => f.changes.length > 0)}
                    columns={[
                      { title: 'file', dataIndex: 'newName', ellipsis: true },
                      {
                        title: '#',
                        width: 50,
                        render: (_, r: FileItem) => (
                          <span className="text-neutral-500">{r.changes.length}</span>
                        ),
                      },
                      {
                        title: '',
                        width: 60,
                        render: (_, r: FileItem) => (
                          <button
                            className="text-xs text-neutral-400 hover:text-neutral-700"
                            onClick={() => setPreviewFile(r)}
                          >
                            preview
                          </button>
                        ),
                      },
                    ]}
                    rowKey="originalPath"
                    size="small"
                    pagination={false}
                    showHeader={false}
                  />
                </div>
              </details>
            )}
          </div>
        )}
        </div>

        {/* Right: Features Intro */}
        <aside className="hidden lg:block w-72 shrink-0">
          <div className="sticky top-8 space-y-6">
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-neutral-700 mb-3">Format Conversion</h3>
              <ul className="space-y-2 text-xs text-neutral-500">
                <li className="flex justify-between">
                  <code className="text-neutral-600">{'{{[[TODO]]}}'}</code>
                  <span>→ [ ]</span>
                </li>
                <li className="flex justify-between">
                  <code className="text-neutral-600">{'{{[[DONE]]}}'}</code>
                  <span>→ [x]</span>
                </li>
                <li className="flex justify-between">
                  <code className="text-neutral-600">^^text^^</code>
                  <span>→ **text**</span>
                </li>
                <li className="flex justify-between">
                  <code className="text-neutral-600">{'{{[[table]]}}'}</code>
                  <span>→ MD Table</span>
                </li>
                <li className="flex justify-between">
                  <code className="text-neutral-600">{'{{[[kanban]]}}'}</code>
                  <span>→ MD Table</span>
                </li>
              </ul>
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold text-neutral-700 mb-3">File Organization</h3>
              <ul className="space-y-2 text-xs text-neutral-500">
                <li>
                  <span className="text-neutral-600">Journal files</span>
                  <div className="text-neutral-400 mt-0.5">February 1st, 2023.md → journals/2023-02-01.md</div>
                </li>
                <li>
                  <span className="text-neutral-600">Other files</span>
                  <div className="text-neutral-400 mt-0.5">→ pages/ folder</div>
                </li>
              </ul>
            </div>
          </div>
        </aside>
      </main>

      {/* Config Drawer */}
      <Drawer
        title="transformation rules"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
        extra={
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setModalOpen(true)}
          >
            add
          </Button>
        }
      >
        <Tabs
          size="small"
          items={[
            {
              key: 'builtin',
              label: `built-in (${rules.length})`,
              children: (
                <div className="space-y-3 mt-2">
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="rule-card p-3 bg-white border border-neutral-200 rounded"
                    >
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => toggleRule(rule.id)}
                      >
                        <div className="flex-1 min-w-0 pr-3">
                          <div className="text-sm font-medium text-neutral-700 mb-0.5">
                            {rule.name}
                          </div>
                          <code className="text-xs text-neutral-400">
                            {rule.id === 'todo'
                              ? `${rule.options?.todoSource || '{{[[TODO]]}}'} → ${rule.options?.todoFormat || '[ ]'}`
                              : rule.id === 'done'
                              ? `${rule.options?.doneSource || '{{[[DONE]]}}'} → ${rule.options?.doneFormat || '[x]'}`
                              : rule.id === 'date-link'
                              ? `[[January 11th, 2026]] → [[2026${rule.options?.dateSeparator || '-'}01${rule.options?.dateSeparator || '-'}11]]`
                              : rule.description}
                          </code>
                        </div>
                        <Switch
                          size="small"
                          checked={rule.enabled}
                        />
                      </div>
                      {/* TODO format option */}
                      {rule.id === 'todo' && rule.enabled && (
                        <div
                          className="mt-2 pt-2 border-t border-neutral-100 space-y-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-neutral-500 whitespace-nowrap w-12">Source:</span>
                            <Input
                              size="small"
                              value={rule.options?.todoSource || '{{[[TODO]]}}'}
                              onChange={(e) => updateRuleOptions('todo', { todoSource: e.target.value })}
                              className="flex-1"
                              placeholder="{{[[TODO]]}}"
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-neutral-500 whitespace-nowrap w-12">Target:</span>
                            <Input
                              size="small"
                              value={rule.options?.todoFormat || '[ ]'}
                              onChange={(e) => updateRuleOptions('todo', { todoFormat: e.target.value })}
                              className="flex-1"
                              placeholder="[ ]"
                            />
                          </div>
                        </div>
                      )}
                      {/* DONE format option */}
                      {rule.id === 'done' && rule.enabled && (
                        <div
                          className="mt-2 pt-2 border-t border-neutral-100 space-y-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-neutral-500 whitespace-nowrap w-12">Source:</span>
                            <Input
                              size="small"
                              value={rule.options?.doneSource || '{{[[DONE]]}}'}
                              onChange={(e) => updateRuleOptions('done', { doneSource: e.target.value })}
                              className="flex-1"
                              placeholder="{{[[DONE]]}}"
                            />
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-neutral-500 whitespace-nowrap w-12">Target:</span>
                            <Input
                              size="small"
                              value={rule.options?.doneFormat || '[x]'}
                              onChange={(e) => updateRuleOptions('done', { doneFormat: e.target.value })}
                              className="flex-1"
                              placeholder="[x]"
                            />
                          </div>
                        </div>
                      )}
                      {/* Date separator option for date-link rule */}
                      {rule.id === 'date-link' && rule.enabled && (
                        <div
                          className="mt-2 pt-2 border-t border-neutral-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-neutral-500">Separator:</span>
                            <Radio.Group
                              size="small"
                              value={rule.options?.dateSeparator || '-'}
                              onChange={(e) => {
                                updateRuleOptions('date-link', { dateSeparator: e.target.value as DateSeparator })
                              }}
                            >
                              <Radio.Button value="-">2026-01-11</Radio.Button>
                              <Radio.Button value="_">2026_01_11</Radio.Button>
                            </Radio.Group>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ),
            },
            {
              key: 'custom',
              label: `custom (${customRules.length})`,
              children:
                customRules.length > 0 ? (
                  <div className="space-y-3 mt-2">
                    {customRules.map((rule) => (
                      <div
                        key={rule.id}
                        className="rule-card flex items-center justify-between p-3 bg-white border border-neutral-200 rounded"
                        onClick={() => toggleRule(rule.id)}
                      >
                        <div className="flex-1 min-w-0 pr-3">
                          <div className="text-sm font-medium text-neutral-700 mb-0.5">
                            {rule.name}
                          </div>
                          <code className="text-xs text-neutral-400 truncate block">
                            {rule.description}
                          </code>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            size="small"
                            checked={rule.enabled}
                          />
                          <button
                            className="text-neutral-400 hover:text-red-500 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation()
                              setCustomRules((prev) =>
                                prev.filter((r) => r.id !== rule.id)
                              )
                            }}
                          >
                            <DeleteOutlined />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-neutral-400 text-sm">
                    no custom rules yet
                  </div>
                ),
            },
            {
              key: 'image-hosting',
              label: 'image hosting',
              children: (
                <div className="mt-2">
                  <ImageHostingConfig config={ossConfig} onChange={setOssConfig} />
                </div>
              ),
            },
          ]}
        />
      </Drawer>

      {/* Add Rule Modal */}
      <Modal
        title="add custom rule"
        open={modalOpen}
        onOk={addCustomRule}
        onCancel={() => setModalOpen(false)}
        okText="add"
        cancelText="cancel"
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            name="name"
            label="name"
            rules={[{ required: true, message: 'required' }]}
          >
            <Input placeholder="remove tags" />
          </Form.Item>
          <Form.Item
            name="pattern"
            label="regex pattern"
            rules={[{ required: true, message: 'required' }]}
            extra="global flag (g) applied automatically"
          >
            <Input placeholder="#\[\[(.+?)\]\]" className="font-mono" />
          </Form.Item>
          <Form.Item
            name="replacement"
            label="replacement"
            rules={[{ required: true, message: 'required' }]}
            extra="use $1, $2 for capture groups"
          >
            <Input placeholder="#$1" className="font-mono" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Preview Modal */}
      <PreviewModal
        open={!!previewFile}
        file={previewFile}
        files={files}
        onClose={() => setPreviewFile(null)}
        onFileChange={setPreviewFile}
      />

      {/* Global Drop Zone Overlay */}
      {isDragging && (
        <div className="fixed inset-0 bg-neutral-900/50 backdrop-blur-sm z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-white border-2 border-dashed border-neutral-800 rounded-lg px-12 py-8 text-center">
            <FolderOpenOutlined className="text-6xl text-neutral-700 mb-4" />
            <p className="text-lg font-medium text-neutral-800">
              drop .md or .zip files here
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
