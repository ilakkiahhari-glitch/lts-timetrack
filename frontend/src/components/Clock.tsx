import { useEffect, useState } from 'react'

export default function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="clock" aria-label="Current date and time">
      <strong>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
      <span>{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>
    </div>
  )
}
