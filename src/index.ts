// Shell — page structure
export { Layout } from "./ui/shell/Layout"
export { Sidebar } from "./ui/shell/Sidebar"
export type { SidebarBrand } from "./ui/shell/Sidebar"
export { Page } from "./ui/shell/Page"
export { PageHeader } from "./ui/shell/PageHeader"
export { Section } from "./ui/shell/Section"
export { MobileBottomNav } from "./ui/shell/MobileBottomNav"
export { MobileMenu } from "./ui/shell/MobileMenu"
export { NavigationDrawer } from "./ui/shell/NavigationDrawer"
export { NavigationContext, useNavigation } from "./ui/shell/navContext"
export { toggleTheme, isActiveRoute } from "./ui/shell/navItems"
export type { NavItem } from "./ui/shell/navItems"

// Layouts — all responsive behavior
export { Stack } from "./ui/layouts/Stack"
export { Inline } from "./ui/layouts/Inline"
export { ListDetail } from "./ui/layouts/ListDetail"
export { PanelLayout } from "./ui/layouts/PanelLayout"
export { ResponsiveColumns } from "./ui/layouts/ResponsiveColumns"
export { ContentLayout } from "./ui/layouts/ContentLayout"
export { CenteredLayout } from "./ui/layouts/CenteredLayout"
export { SwipeTabs } from "./ui/layouts/SwipeTabs"

// Primitives
export { Button } from "./ui/primitives/Button"
export { Card } from "./ui/primitives/Card"
export { Badge } from "./ui/primitives/Badge"
export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "./ui/primitives/Sheet"
export { EmptyState } from "./ui/primitives/EmptyState"
export { Input } from "./ui/primitives/Input"
export { Switch } from "./ui/primitives/Switch"
export { Checkbox } from "./ui/primitives/Checkbox"
export { Select } from "./ui/primitives/Select"
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from "./ui/primitives/Dialog"
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "./ui/primitives/Tabs"
export { Toaster, toast } from "./ui/primitives/Toast"

// Forms
export { Form } from "./ui/forms/Form"
export { FormSection } from "./ui/forms/FormSection"
export { TextField } from "./ui/forms/TextField"
export { TextAreaField } from "./ui/forms/TextAreaField"
export { SelectField } from "./ui/forms/SelectField"
export { SwitchField } from "./ui/forms/SwitchField"
export { CheckboxField } from "./ui/forms/CheckboxField"
export { FormActions } from "./ui/forms/FormActions"

// Data view
export { StateView } from "./ui/data-view/StateView"
export { DataList } from "./ui/data-view/DataList"
export { DataListItem } from "./ui/data-view/DataListItem"
export { DataGrid } from "./ui/data-view/DataGrid"
export { MetadataList } from "./ui/data-view/MetadataList"

// Interaction
export { ActionSurface } from "./ui/interaction/ActionSurface"
export { ActionBar } from "./ui/interaction/ActionBar"
export { BottomActionBar } from "./ui/interaction/BottomActionBar"
export { ConfirmAction } from "./ui/interaction/ConfirmAction"
export { SheetOrPopover } from "./ui/interaction/SheetOrPopover"

// DB context / offline query
export { DbProvider, useDb } from "./ui/db-context"
export { useDbQuery } from "./ui/use-db-query"
