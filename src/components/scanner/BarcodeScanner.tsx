import { useEffect, useRef, useState } from 'react'

import { parseIsbn } from '@/services/isbn'

type ScannerState = 'starting' | 'scanning' | 'denied' | 'unsupported'

/**
 * Сканер EAN-13: ponyfill W3C BarcodeDetector поверх zxing-wasm
 * (wasm самохостится из /zxing/). Камера требует HTTPS или localhost.
 */
export function BarcodeScanner({
  onDetected,
}: {
  onDetected: (isbn: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<ScannerState>('starting')

  // Колбэк держим в ref: иначе новая функция на каждом рендере родителя
  // перезапускала камеру, и тот же штрихкод улетал в поиск дважды.
  const onDetectedRef = useRef(onDetected)
  useEffect(() => {
    onDetectedRef.current = onDetected
  })

  useEffect(() => {
    let cancelled = false
    let fired = false
    let stream: MediaStream | null = null
    let raf = 0

    async function start() {
      // В типах DOM mediaDevices «всегда есть», в реальности — нет (insecure context, старые браузеры)
      const mediaDevices = (navigator as { mediaDevices?: MediaDevices })
        .mediaDevices
      if (!mediaDevices) {
        setState('unsupported')
        return
      }
      // Тяжёлый wasm грузим только при открытии сканера
      const { BarcodeDetector, prepareZXingModule } =
        await import('barcode-detector/ponyfill')
      prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) =>
            path.endsWith('.wasm') ? '/zxing/zxing_reader.wasm' : prefix + path,
        },
      })
      const detector = new BarcodeDetector({ formats: ['ean_13'] })

      try {
        stream = await mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 } },
          audio: false,
        })
      } catch {
        if (!cancelled) setState('denied')
        return
      }
      if (cancelled || !videoRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      videoRef.current.srcObject = stream
      await videoRef.current.play().catch(() => {})
      setState('scanning')

      const tick = async () => {
        if (cancelled) return
        const video = videoRef.current
        if (video && video.readyState >= 2) {
          try {
            const codes = await detector.detect(video)
            for (const code of codes) {
              const parsed = parseIsbn(code.rawValue)
              if (parsed && !fired) {
                fired = true
                ;(navigator as { vibrate?: (ms: number) => boolean }).vibrate?.(
                  80,
                )
                onDetectedRef.current(parsed.isbn13)
                return // остановились: родитель закроет/перезапустит сканер
              }
            }
          } catch {
            // кадр не разобрался — пробуем следующий
          }
        }
        raf = requestAnimationFrame(() => void tick())
      }
      raf = requestAnimationFrame(() => void tick())
    }

    void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="relative overflow-hidden rounded-2xl bg-foreground">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="aspect-[3/4] w-full object-cover"
      />
      {state === 'scanning' && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center"
        >
          <div className="relative h-[34%] w-[78%]">
            {(
              [
                '-top-0 -left-0 border-t-3 border-l-3 rounded-tl-lg',
                '-top-0 -right-0 border-t-3 border-r-3 rounded-tr-lg',
                '-bottom-0 -left-0 border-b-3 border-l-3 rounded-bl-lg',
                '-bottom-0 -right-0 border-b-3 border-r-3 rounded-br-lg',
              ] as const
            ).map((cls) => (
              <i key={cls} className={`absolute size-6 border-white ${cls}`} />
            ))}
            <div className="scanline absolute inset-x-[6%] top-1/2 h-0.5 bg-[#7CE3AE] shadow-[0_0_12px_#7CE3AE] motion-reduce:hidden" />
          </div>
          <p className="absolute bottom-3.5 text-[13px] text-white/85">
            Наведите на штрихкод на задней обложке
          </p>
        </div>
      )}
      {state === 'starting' && (
        <p className="absolute inset-0 grid place-items-center text-sm text-white/80">
          Включаем камеру…
        </p>
      )}
      {state === 'denied' && (
        <div className="absolute inset-0 grid content-center gap-2 px-6 text-center text-sm text-white/90">
          <b>Камера недоступна.</b>
          <span>
            Разрешите доступ к камере в настройках браузера. Камера работает
            только по HTTPS — или введите ISBN цифрами ниже.
          </span>
        </div>
      )}
      {state === 'unsupported' && (
        <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-white/90">
          Этот браузер не даёт доступ к камере — введите ISBN цифрами ниже.
        </p>
      )}
    </div>
  )
}
