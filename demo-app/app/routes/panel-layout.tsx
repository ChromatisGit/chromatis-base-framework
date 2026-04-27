import { useState } from "react"
import {
  Page, PageHeader, Section,
  PanelLayout, Stack,
  Card, Badge, Button, DataList, DataListItem,
} from "@platform/framework"
import { Filter } from "lucide-react"

const tasks = [
  { id: "1", title: "Design new onboarding flow", priority: "high", project: "Onboarding" },
  { id: "2", title: "Fix mobile navigation bug", priority: "high", project: "Mobile App" },
  { id: "3", title: "Write API documentation", priority: "medium", project: "API Migration" },
  { id: "4", title: "Update design tokens", priority: "low", project: "Website Redesign" },
  { id: "5", title: "Review pull requests", priority: "medium", project: "API Migration" },
  { id: "6", title: "Set up staging environment", priority: "high", project: "Infrastructure" },
]

const priorityVariant = {
  high: "destructive",
  medium: "accent",
  low: "secondary",
} as const

const filters = ["All", "High", "Medium", "Low"] as const
type Filter = typeof filters[number]

export default function PanelLayoutDemo() {
  const [activeFilter, setActiveFilter] = useState<Filter>("All")

  const filtered = activeFilter === "All"
    ? tasks
    : tasks.filter((t) => t.priority === activeFilter.toLowerCase())

  const aside = (
    <Stack gap="2" className="p-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
        Filter by priority
      </p>
      {filters.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => setActiveFilter(f)}
          className={[
            "w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors",
            activeFilter === f
              ? "bg-primary/10 text-primary"
              : "text-foreground hover:bg-muted/60",
          ].join(" ")}
        >
          {f}
        </button>
      ))}
    </Stack>
  )

  const main = (
    <div className="p-4">
      <DataList>
        {filtered.map((task) => (
          <DataListItem
            key={task.id}
            label={task.title}
            description={task.project}
            meta={
              <Badge variant={priorityVariant[task.priority as keyof typeof priorityVariant]}>
                {task.priority}
              </Badge>
            }
          />
        ))}
      </DataList>
      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No tasks for this filter.</p>
      )}
    </div>
  )

  return (
    <Page title="Panel Layout">
      <PageHeader
        title="Panel Layout"
        subtitle="Desktop: persistent aside. Mobile: aside in a Sheet."
      />

      <Section title="Task list with filter aside">
        <Card className="h-[60vh] overflow-hidden p-0">
          <PanelLayout
            main={main}
            aside={aside}
            asideWidth={200}
            asideSide="left"
            asideTitle="Filters"
            asideToggle={(open) => (
              <Button variant="outline" size="sm" onClick={open}>
                <Filter className="w-4 h-4" /> Filters
              </Button>
            )}
          />
        </Card>
      </Section>
    </Page>
  )
}
