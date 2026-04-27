import { createContext, useContext } from "react"

interface FormContextValue {
  isPending: boolean
}

export const FormContext = createContext<FormContextValue>({ isPending: false })

export function useFormContext(): FormContextValue {
  return useContext(FormContext)
}
