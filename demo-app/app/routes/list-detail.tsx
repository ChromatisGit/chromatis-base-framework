import { useState } from "react"
import {
  Page, PageHeader, ListDetail, StateView, Stack,
  Card, Badge, ActionSurface,
} from "@chromatis/base"

interface Project {
  id: string
  name: string
  status: "active" | "paused" | "done"
  description: string
  tasks: number
}

const projects: Project[] = [
  { id: "1", name: "Website Redesign", status: "active", description: "Full redesign of the marketing site with new brand identity.", tasks: 12 },
  { id: "2", name: "Mobile App", status: "active", description: "iOS and Android app for customer self-service.", tasks: 34 },
  { id: "3", name: "API Migration", status: "paused", description: "Migrate REST endpoints to GraphQL.", tasks: 8 },
  { id: "4", name: "Analytics Dashboard", status: "done", description: "Internal reporting dashboard for the ops team.", tasks: 21 },
  { id: "5", name: "Onboarding Flow", status: "active", description: "Redesigned onboarding for new users.", tasks: 6 },
]

const statusVariant = {
  active: "accent",
  paused: "secondary",
  done: "success",
} as const

export default function ListDetailDemo() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = projects.find((p) => p.id === selectedId) ?? null

  const list = (
    <Stack gap="1" className="p-2">
      {projects.map((p) => (
        <ActionSurface
          key={p.id}
          rounded="xl"
          onClick={() => setSelectedId(p.id)}
          className={selectedId === p.id ? "bg-primary/10" : ""}
        >
          <div className="flex items-center justify-between px-3 py-3">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.tasks} tasks</span>
            </div>
            <Badge variant={statusVariant[p.status]}>{p.status}</Badge>
          </div>
        </ActionSurface>
      ))}
    </Stack>
  )

  const detail = selected ? (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4 mb-6">
        <h2 className="text-xl font-semibold text-foreground">{selected.name}</h2>
        <Badge variant={statusVariant[selected.status]}>{selected.status}</Badge>
      </div>
      <p className="text-sm text-muted-foreground mb-6">{selected.description}</p>
      <Card className="p-4">
        <p className="text-xs text-muted-foreground mb-1">Open tasks</p>
        <p className="text-2xl font-semibold text-foreground">{selected.tasks}</p>
      </Card>
    </div>
  ) : null

  return (
    <Page title="List Detail">
      <PageHeader
        title="List Detail"
        subtitle="Mobile: tap item to see detail. Desktop: side-by-side."
      />
      <div className="h-[60vh] border border-border rounded-2xl overflow-hidden">
        <ListDetail
          list={list}
          detail={detail}
          detailActive={Boolean(selectedId)}
          emptyDetail={
            <StateView
              state="empty"
              title="No project selected"
              description="Pick a project from the list."
            />
          }
        />
      </div>
    </Page>
  )
}
