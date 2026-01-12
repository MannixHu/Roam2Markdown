import { OSSConfig, MigrationSession } from './imageHosting/types'
import { TransformRule } from './rules'

const DB_NAME = 'roam-migration'
const DB_VERSION = 2 // Upgraded version to add new store
const CONFIG_STORE = 'config'
const SESSION_STORE = 'migration-sessions'

// Complete config type
export interface AppConfig {
  ossConfig: OSSConfig
  customRules: TransformRule[]
  disabledRuleIds: string[] // IDs of disabled built-in rules
}

let dbInstance: IDBDatabase | null = null

/**
 * Open database connection
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
      // Config store
      if (!db.objectStoreNames.contains(CONFIG_STORE)) {
        db.createObjectStore(CONFIG_STORE)
      }
      // Migration session store
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'id' })
      }
    }
  })
}

/**
 * Save complete config
 */
export async function saveAppConfig(config: AppConfig): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CONFIG_STORE, 'readwrite')
    const store = transaction.objectStore(CONFIG_STORE)

    // Convert functions to strings when saving (custom rule transforms)
    const serializableConfig = {
      ...config,
      customRules: config.customRules.map(rule => ({
        ...rule,
        // Save original pattern and replacement for restoration
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
 * Load complete config
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

      // Restore custom rule transform functions
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
 * Clear all config
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

// ==================== Migration Session Related ====================

/**
 * Save migration session
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
 * Get latest pending session
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
      // Find latest running or paused session
      const pending = sessions
        .filter(s => s.status === 'running' || s.status === 'paused')
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]
      resolve(pending || null)
    }
  })
}

/**
 * Get specific session
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
 * Delete migration session
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
 * Clear all completed migration sessions
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
