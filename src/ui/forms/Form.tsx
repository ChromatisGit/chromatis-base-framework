import { type FormHTMLAttributes } from "react"
import { Form as RRForm, useNavigation } from "react-router"
import { FormContext } from "./formContext"

interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, "method"> {
  method?: "post" | "get"
  action?: string
}

export function Form({ method = "post", action, children, ...props }: FormProps) {
  const navigation = useNavigation()
  const isPending = navigation.state === "submitting"

  return (
    <FormContext.Provider value={{ isPending }}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RRForm method={method} {...(action !== undefined ? { action } : {})} {...(props as any)}>
        {children}
      </RRForm>
    </FormContext.Provider>
  )
}
