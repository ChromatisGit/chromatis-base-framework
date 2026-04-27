import { Checkbox } from "../primitives/Checkbox"
import { useFormContext } from "./formContext"
import type { InputHTMLAttributes } from "react"

interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string
  description?: string
  error?: string
}

export function CheckboxField({ disabled, ...props }: CheckboxFieldProps) {
  const { isPending } = useFormContext()
  return <Checkbox disabled={isPending || disabled} {...props} />
}
