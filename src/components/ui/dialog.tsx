'use client'

import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { XIcon } from 'lucide-react'

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        // без backdrop-blur: он заметно тормозит слайд шторки на телефонах
        'fixed inset-0 isolate z-50 bg-black/25 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Свайп вниз закрывает мобильную шторку.
 * Тянем только когда содержимое прокручено в начало — иначе жест принадлежит
 * списку. Слушатели нативные (passive: false), чтобы гасить резину iOS.
 */
function useSheetSwipe(
  contentRef: React.RefObject<HTMLDivElement | null>,
  closeRef: React.RefObject<HTMLButtonElement | null>,
) {
  React.useEffect(() => {
    const el = contentRef.current
    if (!el) return
    if (window.matchMedia('(min-width: 640px)').matches) return

    let startY = 0
    let startedAt = 0
    let shift = 0
    let dragging = false

    /** Жест наш, только если ближайший скроллер уже наверху. */
    const canDrag = (target: EventTarget | null) => {
      let node = target instanceof HTMLElement ? target : null
      while (node && node !== el) {
        if (node.scrollHeight > node.clientHeight + 1) return node.scrollTop <= 0
        node = node.parentElement
      }
      return el.scrollTop <= 0
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      dragging = canDrag(e.target)
      if (!dragging) return
      startY = e.touches[0]!.clientY
      startedAt = e.timeStamp
      shift = 0
      el.style.transition = 'none'
      el.style.willChange = 'transform'
    }

    const onMove = (e: TouchEvent) => {
      if (!dragging) return
      shift = e.touches[0]!.clientY - startY
      if (shift <= 0) {
        el.style.transform = ''
        return
      }
      e.preventDefault()
      // сопротивление к концу хода — шторка не улетает за палец
      el.style.transform = `translateY(${shift > 220 ? 220 + (shift - 220) * 0.3 : shift}px)`
    }

    const onEnd = (e: TouchEvent) => {
      if (!dragging) return
      dragging = false
      el.style.transition = ''
      el.style.transform = ''
      el.style.willChange = ''
      const speed = shift / Math.max(1, e.timeStamp - startedAt)
      if (shift > 110 || (shift > 40 && speed > 0.5)) closeRef.current?.click()
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [contentRef, closeRef])
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)
  useSheetSwipe(contentRef, closeRef)

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={contentRef}
        data-slot="dialog-content"
        className={cn(
          // мобильный — нижняя шторка; от sm — центрированный диалог
          'fixed inset-x-0 bottom-0 z-50 grid max-h-[85dvh] w-full gap-4 overflow-y-auto overscroll-contain rounded-t-2xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-200 outline-none data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-6 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom-6',
          'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-none sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:overflow-visible sm:rounded-xl sm:duration-100 sm:data-open:zoom-in-95 sm:data-open:slide-in-from-bottom-0 sm:data-closed:zoom-out-95 sm:data-closed:slide-out-to-bottom-0',
          className,
        )}
        {...props}
      >
        {/* грип вне потока: в сетке он съедал первый ряд, и шапки шторок
            сжимались до нуля, наезжая на список */}
        <span
          aria-hidden
          data-slot="dialog-grip"
          className="absolute top-1.5 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-border sm:hidden"
        />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
        <DialogPrimitive.Close ref={closeRef} className="hidden" />
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 max-sm:rounded-b-none max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base leading-none font-medium', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
