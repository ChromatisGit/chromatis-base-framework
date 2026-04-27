import { Link, useLocation } from "react-router";
import { cn } from "../primitives/cn.js";
import { isActiveRoute, type NavItem } from "./navItems.js";

interface Props {
  navItems: readonly NavItem[];
}

export function MobileBottomNav({ navItems }: Props) {
  const location = useLocation();

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex bg-card border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main navigation"
    >
      {navItems.map(({ path, label, icon: Icon, badge }) => {
        const isActive = isActiveRoute(path, location.pathname);
        return (
          <Link
            key={path}
            to={path}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] text-xs font-medium transition-colors no-underline",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <div className="relative">
              <Icon size={22} aria-hidden />
              {badge !== undefined && badge > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-none">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </div>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
