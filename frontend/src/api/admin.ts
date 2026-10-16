import { http } from './client'
import type {
  Person,
  PersonCreate,
  PersonType,
  PersonUpdate,
  PersonWithQr,
  SessionSummary,
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

export const listOpenSessions = () =>
  http.get<SessionSummary[]>(`/attendance/sessions${qs({ status: 'OPEN', limit: 500 })}`)
