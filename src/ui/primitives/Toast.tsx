import { Toaster as SonnerToaster } from "sonner"
export { toast } from "sonner"

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: "bg-card text-foreground border border-border shadow-lg rounded-xl text-sm font-medium",
          title: "text-foreground font-medium",
          description: "text-muted-foreground text-xs",
          actionButton: "bg-primary text-primary-foreground text-xs font-medium rounded-lg px-3 py-1.5",
          cancelButton: "bg-muted text-muted-foreground text-xs font-medium rounded-lg px-3 py-1.5",
          success: "border-l-4 border-l-[var(--success)]",
          error: "border-l-4 border-l-destructive",
        },
      }}
    />
  )
}
