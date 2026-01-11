import { OSSConfig, MigrationSession } from './imageHosting/types'
import { TransformRule } from './rules'

const DB_NAME = 'roam-migration'
const DB_VERSION = 2 // 升级版本以添加新 store
const CONFIG_STORE = 'config'
const SESSION_STORE = 'migration-sessions'

// 完整配置类型
export interface AppConfig {
  ossConfig: OSSConfig
  customRules: TransformRule[]
  disabledRuleIds: string[] // 被禁用的内置规则 ID
}

let dbInstance: IDBDatabase | null = null

/**
 * 打开数据库连接
 */
function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)

    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      // 配置存储
      if (!db.objectStoreNames.contains(CONFIG_STORE)) {
        db.createObjectStore(CONFIG_STORE)
      }
      // 迁移会话存储
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'id' })
      }
    }
  })
}

/**
 * 保存完整配置
 */
export async function saveAppConfig(config: AppConfig): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CONFIG_STORE, 'readwrite')
    const store = transaction.objectStore(CONFIG_STORE)

    // 保存时将函数转为字符串（自定义规则的 transform）
    const serializableConfig = {
      ...config,
      customRules: config.customRules.map(rule => ({
        ...rule,
        // 保存原始的 pattern 和 replacement 用于恢复
        _pattern: rule.description.split(' → ')[0],
        _replacement: rule.description.split(' → ')[1] || '',
      }))
    }

    const request = store.put(serializableConfig, 'appConfig')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

/**
 * 加载完整配置
 */
export async function loadAppConfig(): Promise<AppConfig | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CONFIG_STORE, 'readonly')
    const store = transaction.objectStore(CONFIG_STORE)
    const request = store.get('appConfig')

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const saved = request.result
      if (!saved) {
        resolve(null)
        return
      }

      // 恢复自定义规则的 transform 函数
      const config: AppConfig = {
        ...saved,
        customRules: (saved.customRules || []).map((rule: any) => {
          try {
            const pattern = new RegExp(rule._pattern, 'g')
            return {
              ...rule,
              transform: (content: string) => content.replace(pattern, rule._replacement),
            }
          } catch {
            return rule
          }
        })
      }

      resolve(config)
    }
  })
}

/**
 * 清除所有配置
 */
export async function clearConfig(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CONFIG_STORE, 'readwrite')
    const store = transaction.objectStore(CONFIG_STORE)
    const request = store.clear()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

// ==================== 迁移会话相关 ====================

/**
 * 保存迁移会话
 */
export async function saveMigrationSession(session: MigrationSession): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE, 'readwrite')
    const store = transaction.objectStore(SESSION_STORE)
    const request = store.put(session)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

/**
 * 获取最近的未完成会话
 */
export async function getLatestPendingSession(): Promise<MigrationSession | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE, 'readonly')
    const store = transaction.objectStore(SESSION_STORE)
    const request = store.getAll()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const sessions = request.result as MigrationSession[]
      // 找到最近的运行中或暂停的会话
      const pending = sessions
        .filter(s => s.status === 'running' || s.status === 'paused')
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]
      resolve(pending || null)
    }
  })
}

/**
 * 获取指定会话
 */
export async function getMigrationSession(id: string): Promise<MigrationSession | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE, 'readonly')
    const store = transaction.objectStore(SESSION_STORE)
    const request = store.get(id)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result || null)
  })
}

/**
 * 删除迁移会话
 */
export async function deleteMigrationSession(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE, 'readwrite')
    const store = transaction.objectStore(SESSION_STORE)
    const request = store.delete(id)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

/**
 * 清除所有已完成的迁移会话
 */
export async function clearCompletedSessions(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SESSION_STORE, 'readwrite')
    const store = transaction.objectStore(SESSION_STORE)
    const request = store.getAll()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const sessions = request.result as MigrationSession[]
      const completed = sessions.filter(s => s.status === 'completed')

      let pending = completed.length
      if (pending === 0) {
        resolve()
        return
      }

      for (const session of completed) {
        const deleteRequest = store.delete(session.id)
        deleteRequest.onsuccess = () => {
          pending--
          if (pending === 0) resolve()
        }
        deleteRequest.onerror = () => reject(deleteRequest.error)
      }
    }
  })
}
