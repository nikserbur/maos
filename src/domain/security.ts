/**
 * Идентичность, роли и доступ (ТЗ «Требования к пользователям, ролям и окну
 * входа»; REQUIREMENTS.md §3). Рабочий = пользователь системы.
 */
import type { Id } from './nsi'

/** Атомарные права (RBAC). */
export type Permission =
  | 'READ_NSI'
  | 'READ_PLAN'
  | 'READ_KPI'
  | 'EDIT_NSI'
  | 'WRITE_PLAN'
  | 'RUN_OPTIMIZE'
  | 'COMMIT_PLAN'
  | 'IMPORT_DATA'
  | 'EXPORT_DATA'
  | 'USE_AGENT_READ'
  | 'USE_AGENT_WRITE'
  | 'MANAGE_USERS'
  | 'MANAGE_SECURITY'

export type RoleName = 'Viewer' | 'Planner' | 'Technologist' | 'Admin'

export interface Role {
  id: Id
  name: RoleName | string
  description?: string
  permissions: Permission[]
}

/** Учётная запись = рабочий с `isSystemUser=true`. */
export interface UserAccount {
  /** → Worker.id (табельный номер). */
  workerId: Id
  login: string
  roleId: Id
  isSystemUser: boolean
  status: 'активен' | 'отпуск' | 'больничный' | 'уволен'
  lastLoginAt?: string
  failedAttempts?: number
  lockedUntil?: string
  // passwordHash (Argon2id) хранится и проверяется на C++-бэкенде, не на фронте.
}

export interface Session {
  userId: Id
  startedAt: string
  lastActivityAt: string
  expiresAt: string
  /** Какой файл .db открыт. */
  vaultId: string
}
