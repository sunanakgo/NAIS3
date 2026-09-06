import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from 'react'
import { zoomAroundPoint, type Point } from './mask-geometry'

const MIN_ZOOM = 1
const MAX_ZOOM = 16

interface ViewTransform {
  key: string
  zoom: number
  pan: Point
}

export function useImageViewport(
  width: number,
  height: number,
  padding = 16
): {
  viewportRef: React.RefObject<HTMLDivElement | null>
  frameStyle: CSSProperties
  zoomLabel: string
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  onWheel: (event: ReactWheelEvent) => void
  beginPan: (event: ReactPointerEvent) => boolean
  movePan: (event: ReactPointerEvent) => boolean
  endPan: (event: ReactPointerEvent) => void
  panning: boolean
} {
  const imageKey = `${width}x${height}`
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 })
  const [storedTransform, setStoredTransform] = useState<ViewTransform>({
    key: imageKey,
    zoom: 1,
    pan: { x: 0, y: 0 }
  })
  const transform =
    storedTransform.key === imageKey
      ? storedTransform
      : { key: imageKey, zoom: 1, pan: { x: 0, y: 0 } }
  const [panning, setPanning] = useState(false)
  const panStart = useRef<{ pointer: Point; pan: Point; pointerId: number } | null>(null)
  const spaceHeld = useRef(false)

  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const update = (): void =>
      setViewportSize({ width: element.clientWidth || 1, height: element.clientHeight || 1 })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'Space' && !isTextInput(event.target)) {
        spaceHeld.current = true
        event.preventDefault()
      }
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') spaceHeld.current = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const fitScale = Math.min(
    1,
    Math.max(0.01, (viewportSize.width - padding * 2) / Math.max(1, width)),
    Math.max(0.01, (viewportSize.height - padding * 2) / Math.max(1, height))
  )
  const frameWidth = Math.max(1, Math.round(width * fitScale))
  const frameHeight = Math.max(1, Math.round(height * fitScale))

  const setZoomCentered = useCallback(
    (next: number): void => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
      setStoredTransform({
        key: imageKey,
        zoom,
        pan: zoom === 1 ? { x: 0, y: 0 } : transform.pan
      })
    },
    [imageKey, transform.pan]
  )

  const resetView = useCallback((): void => {
    setStoredTransform({ key: imageKey, zoom: 1, pan: { x: 0, y: 0 } })
  }, [imageKey])

  function onWheel(event: ReactWheelEvent): void {
    event.preventDefault()
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const next = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, transform.zoom * Math.exp(-event.deltaY * 0.0015))
    )
    const pointer = {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2
    }
    setStoredTransform({
      key: imageKey,
      zoom: next,
      pan: zoomAroundPoint(transform.pan, transform.zoom, next, pointer)
    })
  }

  function beginPan(event: ReactPointerEvent): boolean {
    if (event.button !== 1 && !(event.button === 0 && spaceHeld.current)) return false
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    panStart.current = {
      pointer: { x: event.clientX, y: event.clientY },
      pan: transform.pan,
      pointerId: event.pointerId
    }
    setPanning(true)
    return true
  }

  function movePan(event: ReactPointerEvent): boolean {
    const start = panStart.current
    if (!start || start.pointerId !== event.pointerId) return false
    setStoredTransform({
      key: imageKey,
      zoom: transform.zoom,
      pan: {
        x: start.pan.x + event.clientX - start.pointer.x,
        y: start.pan.y + event.clientY - start.pointer.y
      }
    })
    return true
  }

  function endPan(event: ReactPointerEvent): void {
    if (panStart.current?.pointerId !== event.pointerId) return
    panStart.current = null
    setPanning(false)
  }

  return {
    viewportRef,
    frameStyle: {
      width: frameWidth,
      height: frameHeight,
      left: `calc(50% - ${frameWidth / 2}px)`,
      top: `calc(50% - ${frameHeight / 2}px)`,
      transform: `translate3d(${transform.pan.x}px, ${transform.pan.y}px, 0) scale(${transform.zoom})`,
      transformOrigin: 'center center'
    },
    zoomLabel: `${Math.round(transform.zoom * 100)}%`,
    zoomIn: () => setZoomCentered(transform.zoom * 1.25),
    zoomOut: () => setZoomCentered(transform.zoom / 1.25),
    resetView,
    onWheel,
    beginPan,
    movePan,
    endPan,
    panning
  }
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}
