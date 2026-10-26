import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { isFromInspector, type FromInspector, type ToInspector } from './inspector-protocol'
import { useI18n } from '../i18n/locale'

export interface PreviewFrameHandle {
  post(msg: ToInspector): void
}

interface Props {
  /** html-preview:// URL bound to this view; null until the main process reports it */
  url: string | null
  /** bump to reload the frame after the buffer was pushed to the main process */
  nonce: number
  zoom: number
  onMessage: (msg: FromInspector) => void
  /** fires for every document the frame loads, link navigations included */
  onLoad?: () => void
  /** the frame may open windows; off while web content is blocked, so a document's
   * script cannot open the user's browser at an address of its choosing */
  allowPopups: boolean
}

/**
 * The document runs in a sandboxed frame with an opaque origin: its scripts run,
 * web content waits for the user's "Load web content" (preview-protocol.ts), and
 * the app itself is out of reach. Reloads go through the src attribute because the frame's window is
 * cross-origin to us; the inspector talks back over postMessage.
 */
export const PreviewFrame = forwardRef<PreviewFrameHandle, Props>(function PreviewFrame(
  { url, nonce, zoom, onMessage, onLoad, allowPopups },
  ref,
) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const { t } = useI18n()
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const src = useMemo(() => (url ? `${url}?v=${nonce}` : 'about:blank'), [url, nonce])

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (isFromInspector(event.data)) onMessageRef.current(event.data)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [])

  useImperativeHandle(ref, () => ({
    post(msg) {
      frameRef.current?.contentWindow?.postMessage(msg, '*')
    },
  }))

  return (
    <div className="preview-host" style={{ zoom: zoom / 100 }}>
      <iframe
        ref={frameRef}
        className="preview-frame"
        title={t('viewPreview')}
        src={src}
        onLoad={onLoad}
        sandbox={`allow-scripts allow-forms allow-modals${allowPopups ? ' allow-popups' : ''}`}
        referrerPolicy="no-referrer"
      />
    </div>
  )
})
