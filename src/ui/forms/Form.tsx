import { type ComponentProps } from "react"
import { Form as RRForm, useNavigation } from "react-router"
import { FormContext } from "./formContext"

type FormProps = Omit<ComponentProps<typeof RRForm>, "method"> & {
  method?: "post" | "get"
}

export function Form({ method = "post", children, ...props }: FormProps) {
  const navigation = useNavigation()
  const isPending = navigation.state === "submitting"

  return (
    <FormContext.Provider value={{ isPending }}>
      <RRForm method={method} {...props}>
        {children}
      </RRForm>
    </FormContext.Provider>
  )
}
