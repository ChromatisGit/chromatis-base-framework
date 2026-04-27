import { useEffect, useState } from "react"

const DESKTOP_QUERY = "(min-width: 768px)"

export function useBreakpoint(): "mobile" | "desktop" {
  const [breakpoint, setBreakpoint] = useState<"mobile" | "desktop">(() => {
    if (typeof window === "undefined") return "mobile"
    return window.matchMedia(DESKTOP_QUERY).matches ? "desktop" : "mobile"
  })

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const handler = (e: MediaQueryListEvent) => {
      setBreakpoint(e.matches ? "desktop" : "mobile")
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  return breakpoint
}
