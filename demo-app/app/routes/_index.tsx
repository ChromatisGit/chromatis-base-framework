import { Link } from "react-router"
import { Page, PageHeader, ResponsiveColumns, Card } from "@platform/framework"
import {
  Columns2, PanelLeft, FormInput, Square,
  LayoutGrid, MessageSquare, List, MousePointer2,
} from "lucide-react"

const sections = [
  { to: "/list-detail", icon: Columns2, label: "List Detail", description: "Responsive list + detail split layout" },
  { to: "/panel-layout", icon: PanelLeft, label: "Panel Layout", description: "Main content with collapsible aside" },
  { to: "/forms", icon: FormInput, label: "Forms", description: "TextField, Select, Switch, Checkbox, FormActions" },
  { to: "/primitives", icon: Square, label: "Primitives", description: "Button, Badge, Input, Card variants" },
  { to: "/layouts", icon: LayoutGrid, label: "Layouts", description: "Stack, Inline, ResponsiveColumns, SwipeTabs" },
  { to: "/dialogs", icon: MessageSquare, label: "Dialogs & Sheets", description: "Dialog, Sheet, Tabs" },
  { to: "/data-view", icon: List, label: "Data View", description: "DataList, DataGrid, MetadataList, StateView" },
  { to: "/interaction", icon: MousePointer2, label: "Interaction", description: "ActionSurface, ConfirmAction, SheetOrPopover" },
]

export default function Index() {
  return (
    <Page title="Platform Demo">
      <PageHeader
        title="Platform Demo"
        subtitle="Component and layout showcase for @platform/framework"
      />
      <ResponsiveColumns minWidth={260} gap="4">
        {sections.map((s) => (
          <Link key={s.to} to={s.to} className="no-underline">
            <Card interactive className="flex items-start gap-4 p-5 h-full">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <s.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{s.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
              </div>
            </Card>
          </Link>
        ))}
      </ResponsiveColumns>
    </Page>
  )
}
