import type { ComponentType, SVGAttributes } from "react";

export interface NavItem {
  path: string;
  label: string;
  icon: ComponentType<SVGAttributes<SVGElement> & { size?: number | string; strokeWidth?: number | string }>;
  badge?: number;
}

export function toggleTheme() {
  const html = document.documentElement;
  if (html.classList.contains("dark")) {
    html.classList.remove("dark");
    localStorage.setItem("theme", "light");
  } else {
    html.classList.add("dark");
    localStorage.setItem("theme", "dark");
  }
}

export function isActiveRoute(path: string, pathname: string): boolean {
  return path === "/" ? pathname === "/" : pathname.startsWith(path);
}
