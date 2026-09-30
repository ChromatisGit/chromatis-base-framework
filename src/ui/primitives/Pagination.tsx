import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PaginationProps {
  page: number;
  totalPages: number;
  href: (page: number) => string;
  label: string;
  previousLabel: string;
  nextLabel: string;
  pageLabel: (page: number) => string;
  statusLabel: (page: number, total: number) => string;
  onPageChange?: (page: number) => void;
}

export function paginationModel(
  page: number,
  total: number,
): Array<number | "gap"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  if (page <= 4) {
    return [1, 2, 3, 4, 5, "gap", total];
  }
  if (page >= total - 3) {
    return [1, "gap", total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, "gap", page - 1, page, page + 1, "gap", total];
}

interface PageLinkProps {
  target: number;
  total: number;
  href: (page: number) => string;
  label: string;
  children: ReactNode;
  current?: boolean;
  direction?: string;
  onPageChange?: ((page: number) => void) | undefined;
}

function PageLink({
  target,
  total,
  href,
  label,
  children,
  current,
  direction,
  onPageChange,
}: PageLinkProps) {
  const disabled = target < 1 || target > total;
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      !onPageChange ||
      disabled ||
      event.button ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onPageChange(target);
  }
  return (
    <a
      className="pagination__link"
      href={disabled ? undefined : href(target)}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-current={current ? "page" : undefined}
      tabIndex={disabled ? -1 : undefined}
      data-dir={direction}
      onClick={onClick}
    >
      {children}
    </a>
  );
}

export function Pagination({
  page,
  totalPages,
  href,
  label,
  previousLabel,
  nextLabel,
  pageLabel,
  statusLabel,
  onPageChange,
}: PaginationProps) {
  const total = Math.max(1, Math.floor(totalPages));
  const current = Math.min(total, Math.max(1, Math.floor(page)));
  return (
    <nav
      className="pagination"
      aria-label={label}
      style={{ "--page-digits": String(total).length } as CSSProperties}
    >
      <ul className="pagination__list">
        <li className="pagination__item">
          <PageLink
            target={current - 1}
            total={total}
            href={href}
            label={previousLabel}
            direction="prev"
            onPageChange={onPageChange}
          >
            <ChevronLeft aria-hidden="true" />
          </PageLink>
        </li>
        {paginationModel(current, total).map((entry, index) =>
          entry === "gap" ? (
            <li
              key={`gap-${index}`}
              className="pagination__item pagination__item--gap"
              aria-hidden="true"
            >
              <span className="pagination__gap">…</span>
            </li>
          ) : (
            <li key={entry} className="pagination__item pagination__item--page">
              <PageLink
                target={entry}
                total={total}
                href={href}
                label={pageLabel(entry)}
                current={entry === current}
                onPageChange={onPageChange}
              >
                {entry}
              </PageLink>
            </li>
          ),
        )}
        <li className="pagination__item pagination__item--status">
          <span className="pagination__status">
            <span className="pagination__sizer" aria-hidden="true">
              {statusLabel(total, total)}
            </span>
            <span>{statusLabel(current, total)}</span>
          </span>
        </li>
        <li className="pagination__item">
          <PageLink
            target={current + 1}
            total={total}
            href={href}
            label={nextLabel}
            direction="next"
            onPageChange={onPageChange}
          >
            <ChevronRight aria-hidden="true" />
          </PageLink>
        </li>
      </ul>
      <span className="visually-hidden" role="status" aria-live="polite">
        {statusLabel(current, total)}
      </span>
    </nav>
  );
}
