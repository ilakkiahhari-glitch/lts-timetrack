import type { ReviewReason, SessionSummary } from '../api/types'

const STATUS: Record<SessionSummary['status'], { label: string; tone: string }> = {
  OPEN: { label: 'Open', tone: 'chip-ok' },
  CLOSED: { label: 'Closed', tone: '' },
  VOIDED: { label: 'Voided', tone: 'chip-off' },
}

export function StatusChip({ status }: { status: SessionSummary['status'] }) {
  const { label, tone } = STATUS[status]
  return <span className={`chip ${tone}`}>{label}</span>
}

const REVIEW_LABEL: Record<ReviewReason, string> = {
  LEFT_OPEN: 'Left open',
  MISSED_EXIT: 'Missed exit',
}

export function ReviewChip({ reason }: { reason: ReviewReason | null }) {
  if (!reason) return null
  return <span className="chip chip-warn">{REVIEW_LABEL[reason]}</span>
}
