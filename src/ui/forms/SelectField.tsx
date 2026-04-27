import { Select } from "../primitives/Select"
import { useFormContext } from "./formContext"
import type { SelectHTMLAttributes } from "react"

interface SelectOption {
  value: string
  label: string
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  label: string
  options: SelectOption[]
  placeholder?: string
  hint?: string
  error?: string
}

export function SelectField({ disabled, ...props }: SelectFieldProps) {
  const { isPending } = useFormContext()
  return <Select disabled={isPending || disabled} {...props} />
}
