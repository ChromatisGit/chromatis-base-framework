import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { SiteShell } from "./shell/SiteShell";
import {
  Breadcrumbs,
  PageHeader,
  ServiceAction,
  ServiceContent,
  EditorialArticle,
} from "./shell/PageCompositions";

const labels = {
  skipToContent: "Skip to content",
  navigation: "Main navigation",
  bottomNavigation: "Shortcuts",
  menu: "Open menu",
  closeMenu: "Close menu",
  showSidebar: "Show navigation",
  hideSidebar: "Hide navigation",
  pagesIn: (section: string) => `Pages in ${section}`,
};
const icons = {
  menu: "M",
  close: "X",
  expand: "V",
  sidebarOpen: "<",
  sidebarClosed: "M",
};
const navigation = [
  { id: "home", label: "Home", to: "/" },
  {
    id: "services",
    label: "Services",
    to: "/services",
    children: [
      {
        id: "registration",
        label: "Registration",
        to: "/services/registration",
      },
    ],
  },
  { id: "contact", label: "Contact", to: "/contact" },
];

describe("third UI slice", () => {
  test("shell shares navigation across sidebar and menu and marks a listed parent", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/services/registration/123"]}>
        <SiteShell
          brand="Portal"
          brandTo="/"
          brandLabel="Portal home"
          navigation={navigation}
          labels={labels}
          icons={icons}
          search={{
            compact: <button type="button">Search</button>,
            full: <button type="button">Search</button>,
          }}
          settings={{
            compact: <button type="button">Settings</button>,
            full: <button type="button">Settings</button>,
          }}
          currentParentTo="/services/registration"
          bottomNavigation={navigation}
          sidebarStorageKey="test-sidebar"
        >
          <h1>Application</h1>
        </SiteShell>
      </MemoryRouter>,
    );
    expect(html).toContain('class="menu-panel"');
    expect(html).toContain('class="shell__sidebar"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('class="bottom-nav"');
    expect(html).toContain("aria-controls=");
    expect(html).toContain("Skip to content");
  });

  test("breadcrumb, service and editorial patterns keep semantic structure", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <>
          <PageHeader
            title="Registration"
            breadcrumbs={
              <Breadcrumbs
                label="Breadcrumb"
                items={[{ label: "Home", to: "/" }, { label: "Registration" }]}
              />
            }
          />
          <ServiceAction
            action={<a href="/apply">Apply</a>}
            facts={[{ label: "Time", value: "10 minutes" }]}
          />
          <ServiceContent
            contentsLabel="On this page"
            sections={[
              {
                id: "requirements",
                title: "Requirements",
                content: <p>Details</p>,
              },
            ]}
          />
          <EditorialArticle header={<PageHeader title="Story" editorial />}>
            <p>Body</p>
          </EditorialArticle>
        </>
      </MemoryRouter>,
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('<dl class="facts">');
    expect(html).toContain('href="#requirements"');
    expect(html).toContain('<article class="editorial-page">');
  });

  test("bottom navigation is absent unless configured", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SiteShell
          brand="Portal"
          brandTo="/"
          brandLabel="Portal home"
          navigation={navigation}
          labels={labels}
          icons={icons}
          sidebarStorageKey="test-sidebar"
        >
          <h1>Home</h1>
        </SiteShell>
      </MemoryRouter>,
    );
    expect(html).toContain("shell--no-bottom-nav");
    expect(html).not.toContain('class="bottom-nav"');
  });
});
