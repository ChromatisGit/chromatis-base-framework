import { useId } from "react"
import { cn } from "./cn"

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  name?: string
  disabled?: boolean
  id?: string
  className?: string
}

export function Switch({ checked, onChange, name, disabled, id, className }: SwitchProps) {
  const generatedId = useId()
  const switchId = id ?? generatedId

  return (
    <>
      {name && (
        <input type="hidden" name={name} value={checked ? "on" : "off"} />
      )}
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          checked ? "bg-primary" : "bg-switch-background",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 mt-0.5",
            checked ? "translate-x-[22px]" : "translate-x-[2px]"
          )}
        />
      </button>
    </>
  )
}
