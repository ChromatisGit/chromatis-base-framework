import { type MutableRefObject, type RefObject, useEffect, useState } from "react"

export function useOverlayMounting(open: boolean, animationMs: number) {
  const [isMounted, setIsMounted] = useState(open)
  const [visualState, setVisualState] = useState<"open" | "closed">(open ? "open" : "closed")

  useEffect(() => {
    if (open) {
      setIsMounted(true)
      setVisualState("closed")
      let frameA = 0
      let frameB = 0
      frameA = window.requestAnimationFrame(() => {
        frameB = window.requestAnimationFrame(() => setVisualState("open"))
      })
      return () => {
        window.cancelAnimationFrame(frameA)
        window.cancelAnimationFrame(frameB)
      }
    }

    setVisualState("closed")
    if (!isMounted) return undefined

    const timeout = window.setTimeout(() => setIsMounted(false), animationMs + 20)
    return () => window.clearTimeout(timeout)
  }, [open, isMounted, animationMs])

  return { isMounted, visualState }
}

export function useOverlayFocus(
  contentRef: RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
  triggerRef: MutableRefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return undefined

    const previousOverflow = document.body.style.overflow
    const previousFocus = document.activeElement as HTMLElement | null
    document.body.style.overflow = "hidden"

    const frame = window.requestAnimationFrame(() => {
      const target =
        contentRef.current?.querySelector<HTMLElement>(
          "[data-autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ) ?? contentRef.current
      target?.focus()
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
      }
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previousOverflow
      ;(triggerRef.current ?? previousFocus)?.focus?.()
    }
  }, [open, setOpen, triggerRef, contentRef])
}
