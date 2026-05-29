import { type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ChevronLeft, ChevronRight, Moon, Sun } from "lucide-react";
import { cn } from "../primitives/cn.js";
import { toggleTheme, isActiveRoute, type NavItem } from "./navItems.js";

export interface SidebarBrand {
  name: string;
  initial: string;
  href?: string;
}

interface Props {
  brand: SidebarBrand;
  mainNavItems: readonly NavItem[];
  secondaryNavItems?: readonly NavItem[];
  footerNavItems?: readonly NavItem[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  collapsible?: boolean;
  userSlot?: ReactNode;
}

export function Sidebar({
  brand,
  mainNavItems,
  secondaryNavItems = [],
  footerNavItems = [],
  collapsed,
  onCollapsedChange,
  collapsible = false,
  userSlot,
}: Props) {
  const location = useLocation();

  function itemClass(path: string) {
    return cn(
      "flex items-center gap-3 w-full rounded-xl text-sm no-underline transition-colors",
      collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5",
      isActiveRoute(path, location.pathname)
        ? "bg-primary text-primary-foreground font-medium"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );
  }

  function renderNavItem({ path, label, icon: Icon, badge }: NavItem) {
    return (
      <Link key={path} to={path} className={itemClass(path)} title={collapsed ? label : undefined}>
        <Icon size={18} className="flex-shrink-0" aria-hidden />
        {!collapsed && (
          <>
            <span className="flex-1">{label}</span>
            {badge !== undefined && badge > 0 && (
              <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold leading-none">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </>
        )}
      </Link>
    );
  }

  return (
    <div
      className={cn(
        "relative flex flex-col h-full bg-card border-r border-border transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Collapse toggle */}
      {collapsible && (
        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          className="absolute -right-3 top-5 z-10 w-6 h-6 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground shadow-sm transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      )}

      {/* Brand */}
      <div className={cn("border-b border-border flex-shrink-0", collapsed ? "px-3 py-5 flex justify-center" : "px-4 py-5")}>
        <Link
          to={brand.href ?? "/"}
          className={cn("flex items-center gap-3 no-underline", collapsed && "justify-center")}
        >
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-primary-foreground text-sm font-bold">{brand.initial}</span>
          </div>
          {!collapsed && (
            <span className="text-base font-semibold text-foreground whitespace-nowrap">{brand.name}</span>
          )}
        </Link>
      </div>

      {/* Nav */}
      <nav
        className={cn("flex-1 overflow-y-auto flex flex-col gap-0.5", collapsed ? "p-1.5" : "p-2")}
        aria-label="Main navigation"
      >
        {mainNavItems.map(renderNavItem)}

        {secondaryNavItems.length > 0 && (
          <>
            <div className="my-1.5 border-t border-border" />
            {secondaryNavItems.map(renderNavItem)}
          </>
        )}
      </nav>

      {/* Bottom: theme toggle (always) + user slot (expanded only) */}
      <div className={cn("flex-shrink-0 border-t border-border flex flex-col gap-0.5", collapsed ? "p-1.5" : "p-2")}>
        <button
          type="button"
          onClick={toggleTheme}
          className={cn(
            "flex items-center gap-3 w-full rounded-xl text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
            collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5",
          )}
          title={collapsed ? "Toggle theme" : undefined}
          aria-label="Toggle theme"
        >
          <Moon size={18} className="flex-shrink-0 dark:hidden" aria-hidden />
          <Sun size={18} className="flex-shrink-0 hidden dark:block" aria-hidden />
          {!collapsed && <span>Toggle theme</span>}
        </button>

        {footerNavItems.length > 0 && (
          <>
            <div className="my-1 border-t border-border" />
            {footerNavItems.map(renderNavItem)}
          </>
        )}

        {userSlot !== undefined && !collapsed && (
          <div className="mt-1">{userSlot}</div>
        )}
      </div>
    </div>
  );
}
