import { http } from './client'
import type {
  AuditEntry,
  CorrectionRequest,
  Device,
  DeviceWithKey,
  Person,
  PersonCreate,
  PersonType,
  PersonUpdate,
  PersonWithQr,
  Rule,
  RuleUpdate,
  SessionDetail,
  SessionSummary,
  User,
  UserCreate,
  UserUpdate,
} from './types'

/** "?a=1&b=2", skipping empty values. */
function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}

export interface PeopleQuery {
  q?: string
  type?: string
  group?: string
  active?: boolean
  limit: number
  offset: number
}

export const listPeople = (query: PeopleQuery) => http.get<Person[]>(`/people${qs({ ...query })}`)
export const getPerson = (id: string) => http.get<Person>(`/people/${id}`)
export const createPerson = (body: PersonCreate) => http.post<PersonWithQr>('/people', body)
export const updatePerson = (id: string, body: PersonUpdate) => http.patch<Person>(`/people/${id}`, body)
export const rotateQr = (id: string) => http.post<PersonWithQr>(`/people/${id}/qr/rotate`)

/** The QR image for a freshly issued token. Rejects with a 404 once it is no longer available. */
export const getQrImage = (id: string) => http.blob(`/people/${id}/qr`)

export const listPersonTypes = () => http.get<PersonType[]>('/person-types')
export const createPersonType = (code: string, displayName: string) =>
  http.post<PersonType>('/person-types', { code, display_name: displayName })

export interface SessionQuery {
  personId?: string
  type?: string
  dateFrom?: string
  dateTo?: string
  status?: 'OPEN' | 'CLOSED' | 'VOIDED'
  needsReview?: boolean
  limit: number
  offset: number
}

export const listSessions = (q: SessionQuery) =>
  http.get<SessionSummary[]>(`/attendance/sessions${qs({
    person_id: q.personId, type: q.type, date_from: q.dateFrom, date_to: q.dateTo, status: q.status,
    needs_review: q.needsReview || undefined, limit: q.limit, offset: q.offset,
  })}`)
export const getSession = (id: string) => http.get<SessionDetail>(`/attendance/sessions/${id}`)
export const correctSession = (id: string, body: CorrectionRequest) =>
  http.post<SessionDetail>(`/attendance/sessions/${id}/correct`, body)

export const listDevices = () => http.get<Device[]>('/devices')
export const createDevice = (name: string, location: string | null) =>
  http.post<DeviceWithKey>('/devices', { name, location })
/** Returns the device, plus `api_key` when `rotate_key` was requested. */
export const updateDevice = (
  id: string,
  change: Partial<{ name: string; location: string | null; is_active: boolean; rotate_key: boolean }>,
) => http.patch<Device | DeviceWithKey>(`/devices/${id}`, change)

export const listUsers = () => http.get<User[]>('/users')
export const createUser = (body: UserCreate) => http.post<User>('/users', body)
export const updateUser = (id: string, change: UserUpdate) => http.patch<User>(`/users/${id}`, change)

export const getRule = (personType: string) => http.get<Rule>(`/attendance-rules/${personType}`)
export const saveRule = (personType: string, rule: RuleUpdate) =>
  http.put<Rule>(`/attendance-rules/${personType}`, rule)

export const listAuditLogs =(q: { entityType: string; entityId: string }) =>
  http.get<AuditEntry[]>(`/audit-logs${qs({ entity_type: q.entityType, entity_id: q.entityId, limit: 100 })}`)
