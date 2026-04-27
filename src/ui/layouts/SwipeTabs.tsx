import { type ReactNode, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { cn } from "../primitives/cn"
import { useReducedMotion } from "../lib/useReducedMotion"
import { useBreakpoint } from "../lib/useBreakpoint"

interface SwipeTab {
  label: string
  value: string
  content: ReactNode
}

interface SwipeTabsProps {
  tabs: SwipeTab[]
  defaultValue?: string
  value?: string
  onChange?: (value: string) => void
}

export function SwipeTabs({ tabs, defaultValue, value: controlledValue, onChange }: SwipeTabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? tabs[0]?.value ?? "")
  const activeValue = controlledValue ?? internalValue
  const activeIndex = tabs.findIndex((t) => t.value === activeValue)
  const reduced = useReducedMotion()
  const breakpoint = useBreakpoint()

  const touchStartX = useRef<number | null>(null)
  const [direction, setDirection] = useState(1)

  function setTab(value: string) {
    const nextIndex = tabs.findIndex((tab) => tab.value === value)
    if (nextIndex !== -1 && activeIndex !== -1) {
      setDirection(nextIndex >= activeIndex ? 1 : -1)
    }
    if (controlledValue === undefined) setInternalValue(value)
    onChange?.(value)
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (breakpoint !== "mobile") return
    touchStartX.current = e.touches[0]?.clientX ?? null
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (breakpoint !== "mobile" || touchStartX.current === null) return
    const endX = e.changedTouches[0]?.clientX ?? touchStartX.current
    const delta = touchStartX.current - endX
    const SWIPE_THRESHOLD = 60

    if (delta > SWIPE_THRESHOLD && activeIndex < tabs.length - 1) {
      const nextTab = tabs[activeIndex + 1]
      if (nextTab) setTab(nextTab.value)
    } else if (delta < -SWIPE_THRESHOLD && activeIndex > 0) {
      const previousTab = tabs[activeIndex - 1]
      if (previousTab) setTab(previousTab.value)
    }
    touchStartX.current = null
  }

  const xEnter = reduced ? 0 : direction * 40
  const xExit = reduced ? 0 : direction * -40

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 flex items-center gap-1 px-2 py-2 border-b border-border overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const active = tab.value === activeValue
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setTab(tab.value)}
              className={cn(
                "flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div
        className="flex-1 min-h-0 overflow-hidden relative"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeValue}
            initial={{ opacity: 0, x: xEnter }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: xExit }}
            transition={{ duration: reduced ? 0 : 0.18, ease: "easeInOut" }}
            className="absolute inset-0 overflow-y-auto"
          >
            {tabs.find((t) => t.value === activeValue)?.content}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
