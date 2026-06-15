import { useRef, useState, useMemo, useEffect, type ReactNode } from "react";
import { Toaster } from "../primitives/Toast.js";
import { useLocation, useNavigate } from "react-router";
import { Menu } from "lucide-react";
import { AnimatePresence, motion, useMotionValue, animate } from "motion/react";
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
  menuFooterSlot?: ReactNode;
};

export function Layout({
  brand,
  mainNavItems,
  sidebar,
  children,
  mobilePattern = "top-tabs",
  menuNavItems = [],
  menuFooterSlot,
}: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const navContext = useMemo(() => ({ openMenu: () => setMenuOpen(true) }), []);
  const [direction, setDirection] = useState(0);

  const currentMainIndex = mainNavItems.findIndex((v) =>
    isActiveRoute(v.path, location.pathname),
  );
  const isMainView = currentMainIndex !== -1;

  // Stable refs for use inside the imperative touchmove listener (avoids stale closures)
  const currentMainIndexRef = useRef(currentMainIndex);
  const mainNavItemsRef = useRef(mainNavItems);
  const isMainViewRef = useRef(isMainView);

  useEffect(() => {
    currentMainIndexRef.current = currentMainIndex;
    mainNavItemsRef.current = mainNavItems;
    isMainViewRef.current = isMainView;
  }, [currentMainIndex, mainNavItems, isMainView]);

  // dragX drives the outer wrapper position during a live finger drag.
  // For swipe-navigations we navigate first (so both pages animate simultaneously)
  // and return dragX to 0 in parallel. We skip the dragX.set(0) reset in the
  // location-change effect for that case so the parallel animation isn't cancelled.
  const dragX = useMotionValue(0);
  const mainRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const isDragConfirmedRef = useRef(false);
  const isSwipeNavigatingRef = useRef(false);

  useEffect(() => {
    // Button-tap navigations: reset dragX (it's already 0, this is a safety net).
    // Swipe navigations: skip — dragX is already animating to 0 concurrently.
    if (!isSwipeNavigatingRef.current) {
      dragX.set(0);
    }
    isSwipeNavigatingRef.current = false;
  }, [location.pathname, dragX]);

  // Attach touchmove with { passive: false } so we can call preventDefault()
  // and prevent the browser from scrolling while a horizontal swipe is in progress.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    function onTouchMove(e: TouchEvent) {
      if (!isMainViewRef.current) return;
      const touch = e.touches[0];
      if (!touch) return;

      const dx = touch.clientX - dragStartRef.current.x;
      const dy = touch.clientY - dragStartRef.current.y;

      if (!isDragConfirmedRef.current) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dy) >= Math.abs(dx)) return;
        isDragConfirmedRef.current = true;
      }

      e.preventDefault();

      const idx = currentMainIndexRef.current;
      const items = mainNavItemsRef.current;

      let constrainedDx = dx;
      if (dx > 0 && idx === 0) {
        // Right swipe on first tab: cap at drawer width so the page only slides as
        // far as it takes to fully reveal the menu behind it.
        constrainedDx = Math.min(dx, Math.min(window.innerWidth * 0.8, 300));
      } else if (dx < 0 && idx >= items.length - 1) {
        // Left swipe at last tab: rubber-band resistance.
        constrainedDx = dx * 0.2;
      }

      dragX.set(constrainedDx);
    }

    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, [dragX]);

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
    const touch = e.touches[0];
    if (!touch) return;
    dragStartRef.current = { x: touch.clientX, y: touch.clientY };
    isDragConfirmedRef.current = false;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!isDragConfirmedRef.current) return;
    isDragConfirmedRef.current = false;

    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - dragStartRef.current.x;
    const velocity = dragX.getVelocity();
    const distanceThreshold = window.innerWidth * 0.35;
    const velocityThreshold = 400;

    const idx = currentMainIndexRef.current;
    const items = mainNavItemsRef.current;

    const goNext = (dx < -distanceThreshold || velocity < -velocityThreshold) && idx < items.length - 1;
    const goPrev = (dx > distanceThreshold || velocity > velocityThreshold) && idx > 0;
    const openMenu = (dx > distanceThreshold || velocity > velocityThreshold) && idx === 0;

    if (goNext || goPrev) {
      const targetItem = items[idx + (goNext ? 1 : -1)];
      if (!targetItem) { snapBack(); return; }

      // Navigate immediately so the new page mounts and both pages animate concurrently:
      // — inner AnimatePresence slides old page out and new page in (0.25s)
      // — outer dragX returns to 0 in the same duration
      // The user sees both pages at the same time throughout the transition.
      isSwipeNavigatingRef.current = true;
      setDirection(goNext ? 1 : -1);
      void navigate(targetItem.path);
      void animate(dragX, 0, { type: "tween", duration: 0.25, ease: "easeInOut" });
    } else if (openMenu) {
      void animate(dragX, 0, { type: "spring", stiffness: 500, damping: 40 });
      setMenuOpen(true);
    } else {
      snapBack();
    }
  }

  function snapBack() {
    void animate(dragX, 0, { type: "spring", stiffness: 500, damping: 40 });
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
                    <span className="hidden min-[480px]:inline">{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </header>
        )}

        {/* Page content */}
        <main
          ref={mainRef}
          className={`flex-1 min-w-0 overflow-hidden relative${mobilePattern === "bottom-tabs" ? " pb-14 md:pb-0" : ""}`}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {/* Mobile: real-time drag wrapper + concurrent page transitions */}
          <motion.div
            className="md:hidden h-full relative overflow-hidden"
            style={{ x: dragX }}
          >
            <AnimatePresence>
              <motion.div
                key={animationKey}
                initial={{
                  x: direction > 0 ? "100%" : direction < 0 ? "-100%" : 0,
                  opacity: direction === 0 ? 0 : 1,
                }}
                animate={{ x: 0, opacity: 1 }}
                exit={{
                  x: direction > 0 ? "-100%" : direction < 0 ? "100%" : 0,
                  opacity: direction === 0 ? 0 : 1,
                  transition: { type: "tween", duration: direction === 0 ? 0.1 : 0.25, ease: "easeInOut" },
                }}
                transition={{ type: "tween", duration: 0.25, ease: "easeInOut" }}
                className="absolute inset-0 overflow-y-auto"
              >
                <div className="w-full max-w-[960px] mx-auto h-full">
                  {children}
                </div>
              </motion.div>
            </AnimatePresence>
          </motion.div>

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
        <MobileMenu brand={brand} isOpen={menuOpen} onClose={() => setMenuOpen(false)} navItems={menuNavItems} pageDragX={dragX} isFirstTab={currentMainIndex === 0} footerSlot={menuFooterSlot} />
      )}

      <Toaster />
    </div>
    </NavigationContext.Provider>
  );
}
