import { Link, useLocation } from "react-router";
import { LogIn, Moon, Sun } from "lucide-react";
import { toggleTheme, isActiveRoute, type NavItem } from "./navItems.js";

interface Props {
  mainNavItems: readonly NavItem[];
  secondaryNavItems: readonly NavItem[];
}

export function Sidebar({ mainNavItems, secondaryNavItems }: Props) {
  const location = useLocation();

  function navItemClass(path: string) {
    return `flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm no-underline transition-colors ${
      isActiveRoute(path, location.pathname)
        ? "bg-primary text-primary-foreground font-medium"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;
  }

  return (
    <div className="flex flex-col w-full h-full bg-card border-r border-border">
      {/* Brand */}
      <div className="px-4 py-5 border-b border-border flex-shrink-0">
        <Link to="/" className="flex items-center gap-3 no-underline">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-primary-foreground text-sm font-bold">D</span>
          </div>
          <span className="text-base font-semibold text-foreground whitespace-nowrap">DropSort</span>
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5" aria-label="Main navigation">
        {/* Main pages */}
        {mainNavItems.map(({ path, label, icon: Icon }) => (
          <Link key={path} to={path} className={navItemClass(path)}>
            <Icon size={18} className="flex-shrink-0" aria-hidden />
            <span>{label}</span>
          </Link>
        ))}

        {/* Section divider */}
        <div className="my-1.5 border-t border-border" />

        {/* Secondary pages */}
        {secondaryNavItems.map(({ path, label, icon: Icon, badge }) => (
          <Link key={path} to={path} className={navItemClass(path)}>
            <Icon size={18} className="flex-shrink-0" aria-hidden />
            <span className="flex-1">{label}</span>
            {badge !== undefined && badge > 0 && (
              <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold leading-none">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="flex-shrink-0 border-t border-border p-2 flex flex-col gap-0.5">
        <button
          type="button"
          onClick={toggleTheme}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <Moon size={18} className="flex-shrink-0 dark:hidden" aria-hidden />
          <Sun size={18} className="flex-shrink-0 hidden dark:block" aria-hidden />
          <span>Toggle theme</span>
        </button>

        <button
          type="button"
          disabled
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm text-muted-foreground/40 cursor-not-allowed"
          title="Login coming soon"
        >
          <LogIn size={18} className="flex-shrink-0" aria-hidden />
          <span>Login</span>
        </button>
      </div>
    </div>
  );
}
