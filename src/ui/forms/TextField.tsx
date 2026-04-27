import { Input } from "../primitives/Input"
import { useFormContext } from "./formContext"
import type { InputHTMLAttributes } from "react"

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  error?: string
}

export function TextField({ disabled, ...props }: TextFieldProps) {
  const { isPending } = useFormContext()
  return <Input disabled={isPending || disabled} {...props} />
}
