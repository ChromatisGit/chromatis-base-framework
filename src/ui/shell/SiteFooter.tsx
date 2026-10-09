import { type ReactNode } from "react";
import { Link } from "react-router";

export interface FooterLinkGroup {
  id: string;
  title: string;
  links: readonly { label: string; to: string }[];
}

export interface SiteFooterProps {
  brand: ReactNode;
  description?: ReactNode;
  groups?: readonly FooterLinkGroup[];
  bottom?: ReactNode;
}

/** Application-owned content in the shared responsive footer layout. */
export function SiteFooter({
  brand,
  description,
  groups,
  bottom,
}: SiteFooterProps) {
  return (
    <footer className="site-footer">
      <div className="site-footer__grid">
        <div>
          <div className="site-footer__heading">{brand}</div>
          {description && <div>{description}</div>}
        </div>
        {groups?.map((group) => (
          <nav key={group.id} aria-label={group.title}>
            <h2 className="site-footer__heading">{group.title}</h2>
            <ul className="site-footer__links">
              {group.links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      {bottom && <div className="site-footer__bottom">{bottom}</div>}
    </footer>
  );
}
