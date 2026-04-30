import { useRef, useState, useMemo, type ReactNode } from "react";
import { Toaster } from "../primitives/Toast.js";
import { useLocation, useNavigate } from "react-router";
import { Menu } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { NavigationContext } from "./navContext.js";
import { MobileMenu } from "./MobileMenu.js";
import { MobileBottomNav } from "./MobileBottomNav.js";
import { isActiveRoute, type NavItem } from "./navItems.js";
import type { SidebarBrand } from "./Sidebar.js";

type LayoutProps = {
  brand: SidebarBrand;
  mainNavItems: readonly NavItem[];
  sidebar: ReactNode;
  children: ReactNode;
  mobilePattern?: "top-tabs" | "bottom-tabs";
  menuNavItems?: readonly NavItem[];
};

export function Layout({
  brand,
  mainNavItems,
  sidebar,
  children,
  mobilePattern = "top-tabs",
  menuNavItems = [],
}: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const navContext = useMemo(() => ({ openMenu: () => setMenuOpen(true) }), []);
  const [direction, setDirection] = useState(0);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const currentMainIndex = mainNavItems.findIndex((v) =>
    isActiveRoute(v.path, location.pathname),
  );
  const isMainView = currentMainIndex !== -1;

  function handleNavigate(path: string) {
    const targetIndex = mainNavItems.findIndex((v) => v.path === path);
    if (currentMainIndex !== -1 && targetIndex !== -1) {
      setDirection(targetIndex > currentMainIndex ? 1 : targetIndex < currentMainIndex ? -1 : 0);
    } else {
      setDirection(0);
    }
    void navigate(path);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (!isMainView) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!isMainView) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const deltaX = touchStartX.current - touch.clientX;
    const deltaY = touchStartY.current - touch.clientY;
    const minSwipeDistance = 50;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minSwipeDistance) {
      if (deltaX > 0 && currentMainIndex < mainNavItems.length - 1) {
        const nextItem = mainNavItems[currentMainIndex + 1];
        if (nextItem) handleNavigate(nextItem.path);
      } else if (deltaX < 0 && currentMainIndex > 0) {
        const previousItem = mainNavItems[currentMainIndex - 1];
        if (previousItem) handleNavigate(previousItem.path);
      }
    }
  }

  const animationKey = isMainView ? location.pathname : "__secondary__";

  return (
    <NavigationContext.Provider value={navContext}>
    <div className="flex h-full bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-shrink-0">
        {sidebar}
      </aside>

      {/* Content area */}
      <div className="flex-1 min-w-0 flex flex-col">

        {/* Mobile top header — top-tabs pattern only */}
        {mobilePattern === "top-tabs" && (
          <header className="md:hidden sticky top-0 z-40 flex items-center gap-1 min-h-14 px-2 border-b border-border bg-card/90 backdrop-blur-sm">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="inline-flex items-center justify-center w-9 h-9 border border-border rounded-[10px] bg-card text-foreground cursor-pointer flex-shrink-0"
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
            <nav className="flex-1 flex items-center justify-between px-2" aria-label="Main navigation">
              {mainNavItems.map((tab) => {
                const Icon = tab.icon;
                const isActive = isActiveRoute(tab.path, location.pathname);
                return (
                  <button
                    key={tab.path}
                    type="button"
                    onClick={() => handleNavigate(tab.path)}
                    className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <Icon size={15} className="flex-shrink-0" aria-hidden />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </header>
        )}

        {/* Page content */}
        <main
          className={`flex-1 min-w-0 overflow-hidden relative${mobilePattern === "bottom-tabs" ? " pb-14 md:pb-0" : ""}`}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Mobile: animated page transitions */}
          <div className="md:hidden h-full relative overflow-hidden">
            <AnimatePresence>
              <motion.div
                key={animationKey}
                initial={{
                  x: direction > 0 ? "100%" : direction < 0 ? "-100%" : 0,
                  opacity: direction === 0 ? 0 : 1,
                }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0 } }}
                transition={{ type: "tween", duration: 0.22, ease: "easeInOut" }}
                className="absolute inset-0 overflow-y-auto"
              >
                <div className="w-full max-w-[960px] mx-auto h-full">
                  {children}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Desktop: no animation */}
          <div className="hidden md:block h-full overflow-y-auto">
            <div className="w-full max-w-[960px] mx-auto h-full">
              {children}
            </div>
          </div>
        </main>
      </div>

      {/* Mobile bottom nav — bottom-tabs pattern only */}
      {mobilePattern === "bottom-tabs" && (
        <MobileBottomNav navItems={mainNavItems} />
      )}

      {/* Mobile hamburger drawer — top-tabs pattern only */}
      {mobilePattern === "top-tabs" && (
        <MobileMenu brand={brand} isOpen={menuOpen} onClose={() => setMenuOpen(false)} navItems={menuNavItems} />
      )}

      <Toaster />
    </div>
    </NavigationContext.Provider>
  );
}
