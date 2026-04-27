import { useState } from "react"
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router"
import {
  Layout,
  Sidebar,
  type NavItem,
  type SidebarBrand,
} from "@platform/framework"
import {
  LayoutDashboard,
  Columns2,
  PanelLeft,
  FormInput,
  Square,
  LayoutGrid,
  MessageSquare,
  List,
  MousePointer2,
} from "lucide-react"
import "@fontsource/plus-jakarta-sans/400.css"
import "@fontsource/plus-jakarta-sans/500.css"
import "@fontsource/plus-jakarta-sans/600.css"
import "@fontsource/plus-jakarta-sans/700.css"
import "@platform/framework/styles"

const brand: SidebarBrand = { name: "Platform Demo", initial: "P", href: "/" }

const navItems: readonly NavItem[] = [
  { path: "/", label: "Overview", icon: LayoutDashboard },
  { path: "/list-detail", label: "List Detail", icon: Columns2 },
  { path: "/panel-layout", label: "Panel Layout", icon: PanelLeft },
  { path: "/forms", label: "Forms", icon: FormInput },
  { path: "/primitives", label: "Primitives", icon: Square },
  { path: "/layouts", label: "Layouts", icon: LayoutGrid },
  { path: "/dialogs", label: "Dialogs & Sheets", icon: MessageSquare },
  { path: "/data-view", label: "Data View", icon: List },
  { path: "/interaction", label: "Interaction", icon: MousePointer2 },
]

export function Layout_({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <Meta />
        <Links />
      </head>
      <body className="h-full">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  const [collapsed, setCollapsed] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const sidebar = (
    <Sidebar
      brand={brand}
      mainNavItems={navItems}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      collapsible
    />
  )

  return (
    <Layout
      brand={brand}
      mainNavItems={navItems}
      sidebar={sidebar}
      menuNavItems={navItems}
      menuOpen={menuOpen}
      onMenuClose={() => setMenuOpen(false)}
      mobilePattern="top-tabs"
    >
      <Outlet />
    </Layout>
  )
}
