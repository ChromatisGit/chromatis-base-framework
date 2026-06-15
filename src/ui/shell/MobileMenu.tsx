import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { X, Moon, Sun } from "lucide-react";
import { motion, useMotionValue, useMotionValueEvent, useTransform, animate, type MotionValue } from "motion/react";
import { toggleTheme, type NavItem } from "./navItems.js";
import type { SidebarBrand } from "./Sidebar.js";

interface Props {
  brand: SidebarBrand;
  isOpen: boolean;
  onClose: () => void;
  navItems: readonly NavItem[];
  pageDragX?: MotionValue<number>;
  isFirstTab?: boolean;
  footerSlot?: ReactNode;
}

export function MobileMenu({ brand, isOpen, onClose, navItems, pageDragX, isFirstTab, footerSlot }: Props) {
  // Drawer position: 0 = fully open, -drawerWidth = fully closed
  const drawerX = useMotionValue(-300);
  const drawerWidthRef = useRef(300);

  // Stable refs for use inside imperative event handlers
  const isOpenRef = useRef(isOpen);
  const isFirstTabRef = useRef(isFirstTab ?? false);

  useEffect(() => {
    isOpenRef.current = isOpen;
    isFirstTabRef.current = isFirstTab ?? false;
  }, [isOpen, isFirstTab]);

  const asideRef = useRef<HTMLElement>(null);
  const swipeStartX = useRef(0);
  const isSwipeConfirmedRef = useRef(false);

  // Compute actual drawer width on mount (matches CSS min(80vw,300px))
  // and set the initial closed position precisely.
  useEffect(() => {
    const w = Math.min(window.innerWidth * 0.8, 300);
    drawerWidthRef.current = w;
    if (!isOpenRef.current) drawerX.set(-w);
  }, [drawerX]);

  // Backdrop opacity derived from drawer position
  const backdropOpacity = useTransform(drawerX, (v) => {
    const w = drawerWidthRef.current;
    return Math.max(0, Math.min(0.35, (v + w) / w * 0.35));
  });

  // Sync drawer position with the page drag so it peeks in as the page slides right
  const fallbackDragX = useMotionValue(0);
  useMotionValueEvent(pageDragX ?? fallbackDragX, "change", (v) => {
    if (!isOpenRef.current && isFirstTabRef.current) {
      drawerX.set(Math.min(0, v - drawerWidthRef.current));
    }
  });

  // Animate drawer open/closed when isOpen changes (button, backdrop, keyboard)
  const skipFirstAnimationRef = useRef(true);
  useEffect(() => {
    // Skip the initial render — drawerX is already set to the correct closed position
    if (skipFirstAnimationRef.current) {
      skipFirstAnimationRef.current = false;
      return;
    }
    const w = drawerWidthRef.current;
    if (isOpen) {
      void animate(drawerX, 0, { type: "spring", stiffness: 400, damping: 40 });
    } else {
      void animate(drawerX, -w, { type: "tween", duration: 0.2, ease: "easeOut" });
    }
  }, [isOpen, drawerX]);

  // Body scroll lock + keyboard close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Non-passive touchmove on the drawer so we can preventDefault during swipe-to-close
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;

    function onTouchMove(e: TouchEvent) {
      if (!isOpenRef.current) return;
      const touch = e.touches[0];
      if (!touch) return;

      const dx = touch.clientX - swipeStartX.current;

      if (!isSwipeConfirmedRef.current) {
        if (Math.abs(dx) < 8) return;
        if (dx >= 0) return; // right swipe on open drawer — ignore
        isSwipeConfirmedRef.current = true;
      }

      e.preventDefault();
      // dx is negative (moving left); clamp so drawer can't go past fully closed
      drawerX.set(Math.max(-drawerWidthRef.current, dx));
    }

    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, [drawerX]);

  function handleSwipeTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0];
    if (!touch) return;
    swipeStartX.current = touch.clientX;
    isSwipeConfirmedRef.current = false;
  }

  function handleSwipeTouchEnd(e: React.TouchEvent) {
    if (!isSwipeConfirmedRef.current) return;
    isSwipeConfirmedRef.current = false;

    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - swipeStartX.current;
    const velocity = drawerX.getVelocity(); // px/s, negative = leftward
    const w = drawerWidthRef.current;

    if (dx < -(w * 0.35) || velocity < -400) {
      // Animate fully closed, then call onClose so isOpen transitions cleanly
      void animate(drawerX, -w, { type: "tween", duration: 0.2, ease: "easeOut" }).then(() => {
        onClose();
      });
    } else {
      void animate(drawerX, 0, { type: "spring", stiffness: 400, damping: 40 });
    }
  }

  return (
    <>
      {/* Backdrop — opacity driven by drawer position, not by isOpen directly */}
      <motion.div
        className={`fixed inset-0 bg-black z-[80] md:hidden ${isOpen ? "pointer-events-auto" : "pointer-events-none"}`}
        style={{ opacity: backdropOpacity }}
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer — position driven by drawerX motion value */}
      <motion.aside
        ref={asideRef as React.RefObject<HTMLElement>}
        className="fixed top-0 left-0 bottom-0 w-[min(80vw,300px)] flex flex-col bg-card border-r border-border z-[90] md:hidden"
        style={{ x: drawerX }}
        aria-hidden={!isOpen}
        onTouchStart={handleSwipeTouchStart}
        onTouchEnd={handleSwipeTouchEnd}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
              <span className="text-primary-foreground text-xs font-bold">{brand.initial}</span>
            </div>
            <span className="text-sm font-semibold text-foreground">{brand.name}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center w-8 h-8 border border-border rounded-[8px] bg-card text-foreground cursor-pointer"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto p-3 flex flex-col gap-0.5" onClick={onClose}>
          {navItems.map(({ path, label, icon: Icon, badge }) => (
            <Link
              key={path}
              to={path}
              className="flex items-center justify-between w-full px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors no-underline"
            >
              <span className="flex items-center gap-3">
                <Icon size={18} className="flex-shrink-0" aria-hidden />
                {label}
              </span>
              {badge !== undefined && badge > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold leading-none">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="flex-shrink-0 border-t border-border p-3 flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => { toggleTheme(); onClose(); }}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Moon size={18} className="flex-shrink-0 dark:hidden" aria-hidden />
            <Sun size={18} className="flex-shrink-0 hidden dark:block" aria-hidden />
            <span>Toggle theme</span>
          </button>

          {footerSlot}
        </div>
      </motion.aside>
    </>
  );
}
