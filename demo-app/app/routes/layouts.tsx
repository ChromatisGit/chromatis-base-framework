import { useState } from "react"
import {
  Page, PageHeader, Section,
  Stack, Inline, ResponsiveColumns,
  ContentLayout, CenteredLayout, SwipeTabs,
  Card, Button, Badge,
} from "@platform/framework"

export default function LayoutsDemo() {
  const [activeTab, setActiveTab] = useState("overview")

  return (
    <Page title="Layouts">
      <PageHeader title="Layouts" subtitle="Stack, Inline, ResponsiveColumns, ContentLayout, CenteredLayout, SwipeTabs" />

      <Section title="Stack — flex column with gap">
        <div className="border border-border rounded-2xl p-4 max-w-xs">
          <Stack gap="3">
            {["First", "Second", "Third"].map((l) => (
              <div key={l} className="bg-muted rounded-xl px-4 py-3 text-sm font-medium">{l}</div>
            ))}
          </Stack>
        </div>
      </Section>

      <Section title="Inline — flex row with wrap">
        <div className="border border-border rounded-2xl p-4">
          <Inline gap="2" wrap>
            {["React", "TypeScript", "Tailwind", "Vite", "React Router", "Bun", "Postgres", "Zod"].map((t) => (
              <Badge key={t} variant="outline">{t}</Badge>
            ))}
          </Inline>
        </div>
      </Section>

      <Section title="ResponsiveColumns — auto-fit grid, no breakpoints">
        <ResponsiveColumns minWidth={200} gap="3">
          {Array.from({ length: 6 }, (_, i) => (
            <Card key={i} className="p-4">
              <p className="text-sm font-medium">Card {i + 1}</p>
              <p className="text-xs text-muted-foreground mt-1">Resize the window</p>
            </Card>
          ))}
        </ResponsiveColumns>
      </Section>

      <Section title="SwipeTabs — swipe on mobile, click on desktop">
        <div className="border border-border rounded-2xl overflow-hidden h-48">
          <SwipeTabs
            value={activeTab}
            onChange={setActiveTab}
            tabs={[
              {
                value: "overview",
                label: "Overview",
                content: (
                  <div className="p-4">
                    <p className="text-sm text-muted-foreground">Overview tab content. Swipe left on mobile.</p>
                  </div>
                ),
              },
              {
                value: "activity",
                label: "Activity",
                content: (
                  <div className="p-4">
                    <p className="text-sm text-muted-foreground">Activity tab content.</p>
                  </div>
                ),
              },
              {
                value: "settings",
                label: "Settings",
                content: (
                  <div className="p-4">
                    <p className="text-sm text-muted-foreground">Settings tab content.</p>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Section>

      <Section title="ContentLayout — narrow centered prose column">
        <div className="border border-border rounded-2xl overflow-hidden py-6">
          <ContentLayout>
            <p className="text-sm text-foreground leading-relaxed">
              This is a <strong>ContentLayout</strong> — content is constrained to a comfortable
              reading width (720px max) and centered. Great for articles, chapters, or any
              long-form text content. The padding scales with the viewport.
            </p>
          </ContentLayout>
        </div>
      </Section>

      <Section title="CenteredLayout — vertically + horizontally centered">
        <div className="border border-border rounded-2xl overflow-hidden h-48">
          <CenteredLayout>
            <Card className="p-6 text-center">
              <p className="text-sm font-medium">Centered content</p>
              <p className="text-xs text-muted-foreground mt-1">Used for auth forms and onboarding</p>
              <Button className="mt-4" size="sm">Get started</Button>
            </Card>
          </CenteredLayout>
        </div>
      </Section>
    </Page>
  )
}
