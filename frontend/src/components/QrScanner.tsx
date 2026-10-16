import jsQR from 'jsqr'
import { useEffect, useRef, useState } from 'react'

interface Props {
  onDetect: (text: string) => void
}

function describeCameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera permission was denied. Allow camera access for this site, then retry.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found. Use the box below with a USB scanner, or type the code.'
  }
  if (name === 'NotReadableError') return 'The camera is in use by another application.'
  return 'The camera could not be started.'
}

/** Live camera view that reads QR codes. Reports every decode; the caller decides what to ignore. */
export default function QrScanner({ onDetect }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onDetectRef = useRef(onDetect)
  const [state, setState] = useState<'starting' | 'ready' | 'error'>('starting')
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    onDetectRef.current = onDetect
  })

  useEffect(() => {
    let stream: MediaStream | null = null
    let frame = 0
    let cancelled = false
    let lastDecode = 0
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    function decode(now: number) {
      frame = requestAnimationFrame(decode)
      const video = videoRef.current
      if (now - lastDecode < 100 || !video || video.readyState < 2 || !ctx || !video.videoWidth) return
      lastDecode = now // about 10 decodes a second is plenty for a held-up badge
      const scale = Math.min(1, 640 / video.videoWidth)
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })
      if (code?.data) onDetectRef.current(code.data)
    }

    async function start() {
      setState('starting')
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage('Camera access needs a secure connection (HTTPS) or localhost.')
        setState('error')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        setState('ready')
        frame = requestAnimationFrame(decode)
      } catch (e) {
        if (cancelled) return
        setMessage(describeCameraError(e))
        setState('error')
      }
    }

    void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [attempt])

  return (
    <div className="scanner">
      <video ref={videoRef} className="scanner-video" playsInline muted aria-label="Camera view" />
      {state === 'ready' && <div className="scanner-frame" aria-hidden="true" />}
      {state !== 'ready' && (
        <div className="scanner-overlay" role={state === 'error' ? 'alert' : 'status'}>
          <p>{state === 'starting' ? 'Starting camera…' : message}</p>
          {state === 'error' && (
            <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
              Retry camera
            </button>
          )}
        </div>
      )}
    </div>
  )
}
