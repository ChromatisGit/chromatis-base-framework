import { useLocation, useNavigate } from "react-router";
import { X } from "lucide-react";
import { toggleTheme, isActiveRoute, type NavItem } from "./navItems.js";
import type { SidebarBrand } from "./Sidebar.js";

interface Props {
  brand: SidebarBrand;
  isOpen: boolean;
  onClose: () => void;
  mainNavItems: readonly NavItem[];
  secondaryNavItems: readonly NavItem[];
}

export function NavigationDrawer({ brand, isOpen, onClose, mainNavItems, secondaryNavItems }: Props) {
  const location = useLocation();
  const navigate = useNavigate();

  function handleNavigate(path: string) {
    void navigate(path);
    onClose();
  }

  const allItems = [
    ...mainNavItems.map((item) => ({ ...item, secondary: false })),
    ...secondaryNavItems.map((item) => ({ ...item, secondary: true })),
  ];

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="absolute inset-0 bg-black/20 dark:bg-black/40 z-40 transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`absolute top-0 left-0 h-full w-72 bg-card border-r border-border z-50 transform transition-transform duration-300 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h2 className="text-xl font-medium text-foreground">{brand.name}</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 p-4 space-y-1">
            {allItems.map((item) => {
              const Icon = item.icon;
              const isActive = isActiveRoute(item.path, location.pathname);

              return (
                <button
                  key={item.path}
                  onClick={() => handleNavigate(item.path)}
                  className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl transition-all ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : item.secondary
                      ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="ml-auto min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-primary-foreground text-primary text-xs font-semibold leading-none">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="p-6 border-t border-border space-y-4">
            <button
              onClick={toggleTheme}
              className="w-full flex items-center gap-3 px-4 py-3 bg-muted rounded-xl hover:bg-accent transition-colors text-sm text-foreground"
            >
              <span>Toggle theme</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
