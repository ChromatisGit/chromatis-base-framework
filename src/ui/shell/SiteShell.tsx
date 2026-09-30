import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { cn } from "../primitives/cn.js";

export interface NavigationItem {
  id: string;
  label: string;
  to: string;
  icon?: ReactNode;
  badge?: ReactNode;
  children?: readonly NavigationItem[];
}

export interface ShellLabels {
  skipToContent: string;
  navigation: string;
  bottomNavigation: string;
  menu: string;
  closeMenu: string;
  showSidebar: string;
  hideSidebar: string;
  pagesIn: (section: string) => string;
}

export interface ShellIcons {
  menu: ReactNode;
  close: ReactNode;
  expand: ReactNode;
  sidebarOpen: ReactNode;
  sidebarClosed: ReactNode;
}

export interface ShellActionSlot {
  compact: ReactNode;
  full: ReactNode;
}

export interface SiteShellProps {
  brand: ReactNode;
  brandTo: string;
  brandLabel: string;
  navigation: readonly NavigationItem[];
  labels: ShellLabels;
  icons: ShellIcons;
  search?: ShellActionSlot;
  settings?: ShellActionSlot;
  /** Application-specific utility controls, such as search and settings. */
  utilities?: ReactNode;
  /** Compact equivalents of utilities for the phone masthead. */
  quickActions?: ReactNode;
  /** Three to five application-selected shortcuts. Omit to hide the bar. */
  bottomNavigation?: readonly NavigationItem[];
  /** A page absent from navigation can identify its listed parent. */
  currentParentTo?: string;
  /** Application-specific key; keeps sidebar choice separate per application. */
  sidebarStorageKey: string;
  children: ReactNode;
  footer?: ReactNode;
}

function normalPath(path: string) {
  return path.replace(/\/+$/, "") || "/";
}

function containsPath(item: NavigationItem, path: string): boolean {
  return (
    item.to === path ||
    !!item.children?.some((child) => containsPath(child, path))
  );
}

// The nested navigation markup keeps one disclosure state per section.
// eslint-disable-next-line max-lines-per-function
function NavigationTree({
  items,
  path,
  parentPath,
  label,
  pagesIn,
  expandIcon,
  onNavigate,
  compact = false,
}: {
  items: readonly NavigationItem[];
  path: string;
  parentPath?: string | undefined;
  label: string;
  pagesIn: ShellLabels["pagesIn"];
  expandIcon: ReactNode;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const prefix = useId();
  const selected = parentPath ?? path;
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => setOverrides({}), [selected]);

  function links(nodes: readonly NavigationItem[], depth = 0): ReactNode {
    return (
      <ul className={cn("section-nav__list", depth > 0 && "section-nav__sub")}>
        {nodes.map((item) => {
          const current = item.to === path;
          const parentCurrent = !current && item.to === parentPath;
          const ancestor =
            containsPath(item, selected) && !current && !parentCurrent;
          return (
            <li key={item.id}>
              <Link
                className={cn("section-nav__link", ancestor && "is-ancestor")}
                to={item.to}
                aria-current={
                  current ? "page" : parentCurrent ? "true" : undefined
                }
                onClick={onNavigate}
              >
                <span>{item.label}</span>
                {item.badge && (
                  <span className="badge badge--count">{item.badge}</span>
                )}
              </Link>
              {item.children && links(item.children, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <nav className="section-nav" aria-label={label}>
      {items.map((item) => {
        const current = item.to === path;
        const parentCurrent = !current && item.to === parentPath;
        const ancestor =
          containsPath(item, selected) && !current && !parentCurrent;
        const open =
          overrides[item.id] ?? (ancestor || current || parentCurrent);
        const panelId = `${prefix}-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        return (
          <div className="section-nav__section" key={item.id}>
            <div className="section-nav__row">
              <Link
                className={cn(
                  "section-nav__link section-nav__link--section",
                  ancestor && "is-ancestor",
                )}
                to={item.to}
                aria-current={
                  current ? "page" : parentCurrent ? "true" : undefined
                }
                aria-label={compact ? item.label : undefined}
                title={compact ? item.label : undefined}
                onClick={onNavigate}
              >
                <span className="section-nav__text">
                  {item.icon ? (
                    <span className="section-nav__icon" aria-hidden="true">
                      {item.icon}
                    </span>
                  ) : (
                    <span className="section-nav__initial" aria-hidden="true">
                      {item.label.charAt(0)}
                    </span>
                  )}
                  <span className="section-nav__link-label">{item.label}</span>
                </span>
                {item.badge && (
                  <span className="badge badge--count">{item.badge}</span>
                )}
              </Link>
              {!!item.children?.length && (
                <button
                  className="icon-btn section-nav__expand"
                  type="button"
                  aria-label={pagesIn(item.label)}
                  aria-controls={panelId}
                  aria-expanded={open}
                  onClick={() =>
                    setOverrides((state) => ({ ...state, [item.id]: !open }))
                  }
                >
                  <span className="section-nav__chevron" aria-hidden="true">
                    {expandIcon}
                  </span>
                </button>
              )}
            </div>
            {!!item.children?.length && (
              <div className="section-nav__pages" id={panelId} hidden={!open}>
                {links(item.children)}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

// The shell owns menu focus, scroll behavior, and responsive navigation markup.
// eslint-disable-next-line max-lines-per-function
export function SiteShell({
  brand,
  brandTo,
  brandLabel,
  navigation,
  labels,
  icons,
  search,
  settings,
  utilities,
  quickActions,
  bottomNavigation,
  currentParentTo,
  sidebarStorageKey,
  children,
  footer,
}: SiteShellProps) {
  const path = normalPath(useLocation().pathname);
  const menuId = useId();
  const sidebarId = useId();
  const mainId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [concealed, setConcealed] = useState(false);

  useEffect(() => {
    try {
      setSidebarOpen(localStorage.getItem(sidebarStorageKey) !== "closed");
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, [sidebarStorageKey]);

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const wide = window.matchMedia("(min-width: 768px)");
    const onWide = () => {
      if (wide.matches) {
        setMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector("dialog[open]")
      ) {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    wide.addEventListener("change", onWide);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      wide.removeEventListener("change", onWide);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [menuOpen]);

  useEffect(() => {
    let previous = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const header = headerRef.current;
      if (!header) {
        return;
      }
      shellRef.current?.style.setProperty(
        "--shell-top",
        `${Math.max(0, Math.round(header.getBoundingClientRect().bottom))}px`,
      );
      if (
        menuOpen ||
        header.contains(document.activeElement) ||
        y <= header.offsetHeight
      ) {
        setConcealed(false);
      } else if (y > previous + 8) {
        setConcealed(true);
        previous = y;
      } else if (y < previous - 8) {
        setConcealed(false);
        previous = y;
      }
    };
    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(update);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [menuOpen]);

  const toggleSidebar = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    try {
      localStorage.setItem(sidebarStorageKey, next ? "open" : "closed");
    } catch {
      /* Ignore storage errors. */
    }
  };

  return (
    <>
      <a className="skip-link" href={`#${mainId}`}>
        {labels.skipToContent}
      </a>
      <header
        ref={headerRef}
        className="site-header site-header--static"
        data-concealed={concealed && !menuOpen ? "" : undefined}
        onFocusCapture={() => setConcealed(false)}
      >
        <div className="site-header__brand surface-brand">
          <div className="site-header__brand-inner">
            <Link className="brand" to={brandTo} aria-label={brandLabel}>
              {brand}
            </Link>
            <div className="site-header__quick">
              {search?.compact}
              {settings?.compact}
              {quickActions}
              <button
                ref={menuButtonRef}
                className="icon-btn site-header__menu-btn"
                type="button"
                aria-label={menuOpen ? labels.closeMenu : labels.menu}
                aria-expanded={menuOpen}
                aria-controls={menuId}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                <span aria-hidden="true">
                  {menuOpen ? icons.close : icons.menu}
                </span>
              </button>
            </div>
            {(search || settings || utilities) && (
              <div className="site-header__utilities">
                {search?.full}
                {settings?.full}
                {utilities}
              </div>
            )}
          </div>
        </div>
        <div
          className="menu-panel"
          id={menuId}
          data-open={menuOpen ? "" : undefined}
        >
          <NavigationTree
            items={navigation}
            path={path}
            parentPath={currentParentTo}
            label={labels.navigation}
            pagesIn={labels.pagesIn}
            expandIcon={icons.expand}
            onNavigate={() => setMenuOpen(false)}
          />
        </div>
      </header>
      <div
        ref={shellRef}
        className={cn(
          "shell",
          !sidebarOpen && "shell--collapsed",
          !bottomNavigation?.length && "shell--no-bottom-nav",
        )}
      >
        <aside className="shell__sidebar">
          <button
            className="shell__toggle"
            type="button"
            aria-expanded={sidebarOpen}
            aria-controls={sidebarId}
            aria-label={sidebarOpen ? labels.hideSidebar : labels.showSidebar}
            onClick={toggleSidebar}
          >
            <span aria-hidden="true">
              {sidebarOpen ? icons.sidebarOpen : icons.sidebarClosed}
            </span>
            <span className="shell__toggle-label">
              {sidebarOpen ? labels.hideSidebar : labels.showSidebar}
            </span>
          </button>
          <div id={sidebarId}>
            <NavigationTree
              items={navigation}
              path={path}
              parentPath={currentParentTo}
              label={labels.navigation}
              pagesIn={labels.pagesIn}
              expandIcon={icons.expand}
              compact={!sidebarOpen}
            />
          </div>
        </aside>
        <div className="shell__main">
          <main id={mainId}>{children}</main>
          {footer}
        </div>
      </div>
      {!!bottomNavigation?.length && (
        <nav className="bottom-nav" aria-label={labels.bottomNavigation}>
          <ul className="bottom-nav__list">
            {bottomNavigation.map((item) => {
              const current = item.to === path;
              const parentCurrent =
                !current && containsPath(item, currentParentTo ?? path);
              return (
                <li key={item.id}>
                  <Link
                    className="bottom-nav__link"
                    to={item.to}
                    aria-current={
                      current ? "page" : parentCurrent ? "true" : undefined
                    }
                  >
                    <span className="bottom-nav__icon">
                      {item.icon}
                      {item.badge && (
                        <span className="badge badge--count">{item.badge}</span>
                      )}
                    </span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </>
  );
}
