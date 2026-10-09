import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../primitives/cn.js";

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export interface BreadcrumbsProps {
  items: readonly BreadcrumbItem[];
  label: string;
}

export function Breadcrumbs({ items, label }: BreadcrumbsProps) {
  return (
    <nav className="breadcrumbs" aria-label={label}>
      <ol className="breadcrumbs__list">
        {items.map((item, index) => (
          <Fragment key={`${item.to ?? "current"}-${index}`}>
            {items.length >= 4 && index === 1 && (
              <li
                className="breadcrumbs__item breadcrumbs__ellipsis"
                aria-hidden="true"
                key="ellipsis"
              >
                <span>…</span>
              </li>
            )}
            <li
              className={cn(
                "breadcrumbs__item",
                items.length >= 4 &&
                  index > 0 &&
                  index < items.length - 2 &&
                  "breadcrumbs__item--collapse",
              )}
            >
              {index < items.length - 1 && item.to ? (
                <Link className="breadcrumbs__link" to={item.to}>
                  {item.label}
                </Link>
              ) : (
                <span className="breadcrumbs__current" aria-current="page">
                  {item.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps extends HTMLAttributes<HTMLElement> {
  title: string;
  breadcrumbs?: ReactNode;
  kicker?: ReactNode;
  meta?: ReactNode;
  lead?: ReactNode;
  editorial?: boolean;
}

export function PageHeader({
  title,
  breadcrumbs,
  kicker,
  meta,
  lead,
  editorial = false,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "page-head",
        editorial && "container editorial-head",
        className,
      )}
      {...props}
    >
      {breadcrumbs}
      {kicker && <p className="kicker">{kicker}</p>}
      <h1 className={cn("h1", editorial && "display")}>{title}</h1>
      {meta}
      {lead && <p className="lead">{lead}</p>}
    </header>
  );
}

export interface Fact {
  label: string;
  value: ReactNode;
}

export function Facts({
  items,
  inline = false,
}: {
  items: readonly Fact[];
  inline?: boolean;
}) {
  return (
    <dl className={cn("facts", inline && "facts--inline")}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface ServiceActionProps {
  action: ReactNode;
  facts?: readonly Fact[];
}

export function ServiceAction({ action, facts }: ServiceActionProps) {
  return (
    <div className="service-action">
      <div className="service-action__cta surface-accent">{action}</div>
      {!!facts?.length && <Facts items={facts} />}
    </div>
  );
}

export interface ServiceSection {
  id: string;
  title: string;
  content: ReactNode;
}

export interface ServiceContentProps {
  sections: readonly ServiceSection[];
  contentsLabel: string;
}

export function ServiceContent({
  sections,
  contentsLabel,
}: ServiceContentProps) {
  return (
    <div className="service-layout">
      <nav className="toc" aria-label={contentsLabel}>
        <p className="toc__title">{contentsLabel}</p>
        <ul className="toc__list">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="content-sections">
        {sections.map((section) => (
          <section
            className="content-section"
            id={section.id}
            key={section.id}
            tabIndex={-1}
          >
            <h2 className="h2">{section.title}</h2>
            {section.content}
          </section>
        ))}
      </div>
    </div>
  );
}

export interface EditorialArticleProps {
  header: ReactNode;
  figure?: ReactNode;
  introduction?: ReactNode;
  children: ReactNode;
  related?: ReactNode;
}

export function EditorialArticle({
  header,
  figure,
  introduction,
  children,
  related,
}: EditorialArticleProps) {
  return (
    <article className="editorial-page">
      {header}
      {figure && (
        <figure className="editorial-figure container container--wide">
          {figure}
        </figure>
      )}
      <div className="container container--reading section section--flush-top">
        {introduction && <div className="editorial-intro">{introduction}</div>}
        <div className="editorial-body prose prose--editorial">{children}</div>
      </div>
      {related && (
        <aside className="editorial-band surface-emphasis section">
          <div className="container container--reading">{related}</div>
        </aside>
      )}
    </article>
  );
}
