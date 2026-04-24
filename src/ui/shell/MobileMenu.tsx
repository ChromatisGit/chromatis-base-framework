import { useEffect } from "react";
import { Link } from "react-router";
import { X, Moon, Sun, LogIn } from "lucide-react";
import { toggleTheme, type NavItem } from "./navItems.js";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  navItems: readonly NavItem[];
}

export function MobileMenu({ isOpen, onClose, navItems }: Props) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/35 z-[80] transition-opacity duration-150 md:hidden ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <aside
        className={`fixed top-0 left-0 bottom-0 w-[min(80vw,300px)] flex flex-col bg-card border-r border-border z-[90] transform transition-transform duration-200 md:hidden ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!isOpen}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
              <span className="text-primary-foreground text-xs font-bold">D</span>
            </div>
            <span className="text-sm font-semibold text-foreground">DropSort</span>
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
      </aside>
    </>
  );
}
