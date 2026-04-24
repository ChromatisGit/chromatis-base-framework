import { useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { Menu } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useNavigation } from "./navContext.js";
import { MobileMenu } from "./MobileMenu.js";
import { isActiveRoute, type NavItem } from "./navItems.js";

type LayoutProps = {
  mainNavItems: readonly NavItem[];
  menuNavItems: readonly NavItem[];
  sidebar: ReactNode;
  children: ReactNode;
  menuOpen: boolean;
  onMenuClose: () => void;
};


export function Layout({ mainNavItems, menuNavItems, sidebar, children, menuOpen, onMenuClose }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { openMenu } = useNavigation();
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
      setDirection(
        targetIndex > currentMainIndex ? 1 : targetIndex < currentMainIndex ? -1 : 0,
      );
    } else {
      setDirection(0);
    }
    void navigate(path);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (!isMainView) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!isMainView) return;
    const deltaX = touchStartX.current - e.changedTouches[0].clientX;
    const deltaY = touchStartY.current - e.changedTouches[0].clientY;
    const minSwipeDistance = 50;

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > minSwipeDistance) {
      if (deltaX > 0 && currentMainIndex < mainNavItems.length - 1) {
        handleNavigate(mainNavItems[currentMainIndex + 1].path);
      } else if (deltaX < 0 && currentMainIndex > 0) {
        handleNavigate(mainNavItems[currentMainIndex - 1].path);
      }
    }
  }

  // Animation key: for main views use the path, for secondary views use a stable key
  // so navigating between secondary pages doesn't animate
  const animationKey = isMainView ? location.pathname : "__secondary__";

  return (
    <div className="flex h-full bg-background">
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-60 flex-shrink-0">
        {sidebar}
      </aside>

      {/* ── Content area ── */}
      <div className="flex-1 min-w-0 flex flex-col">

        {/* Mobile top header */}
        <header className="md:hidden sticky top-0 z-40 flex items-center gap-1 min-h-14 px-2 border-b border-border bg-card/90 backdrop-blur-sm">
          {/* Hamburger */}
          <button
            type="button"
            onClick={openMenu}
            className="inline-flex items-center justify-center w-9 h-9 border border-border rounded-[10px] bg-card text-foreground cursor-pointer flex-shrink-0"
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>

          {/* Main page tabs — centered, with a right spacer matching the hamburger width */}
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

        {/* Page content */}
        <main
          className="flex-1 min-w-0 overflow-hidden relative"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Mobile: animated page transitions
              Strategy: only animate the ENTERING page. The exiting page
              disappears instantly (opacity 0, duration 0) to avoid showing
              the wrong content — <Outlet /> always reflects the current route
              via Router context, so we cannot safely animate it out. */}
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

      {/* Mobile hamburger menu */}
      <MobileMenu isOpen={menuOpen} onClose={onMenuClose} navItems={menuNavItems} />
    </div>
  );
}
