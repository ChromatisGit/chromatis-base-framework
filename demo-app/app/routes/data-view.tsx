import {
  Page, PageHeader, Section, Stack, Inline,
  StateView, DataList, DataListItem, DataGrid, MetadataList,
  Card, Badge, Button,
} from "@platform/framework"
import { FileText, Folder, Settings, User, Trash2 } from "lucide-react"

export default function DataViewDemo() {
  return (
    <Page title="Data View">
      <PageHeader title="Data View" subtitle="StateView, DataList, DataListItem, DataGrid, MetadataList" />

      <Section title="StateView — states">
        <Inline gap="4" wrap>
          <div className="border border-border rounded-2xl overflow-hidden w-72 h-40">
            <StateView
              state="loading"
              title="Loading projects"
              description="Fetching your data…"
            />
          </div>
          <div className="border border-border rounded-2xl overflow-hidden w-72 h-40">
            <StateView
              state="empty"
              title="No projects yet"
              description="Create your first project to get started."
              action={<Button size="sm">New project</Button>}
            />
          </div>
          <div className="border border-border rounded-2xl overflow-hidden w-72 h-40">
            <StateView
              state="error"
              title="Failed to load"
              description="Check your connection and try again."
              action={<Button variant="outline" size="sm">Retry</Button>}
            />
          </div>
        </Inline>
      </Section>

      <Section title="DataList — with icons, meta, actions">
        <div className="max-w-lg">
          <DataList>
            <DataListItem
              label="Project brief.pdf"
              description="Updated 2 days ago"
              icon={<FileText className="w-4 h-4" />}
              meta={<Badge variant="secondary">PDF</Badge>}
              chevron
            />
            <DataListItem
              label="Design assets"
              description="12 files"
              icon={<Folder className="w-4 h-4" />}
              chevron
            />
            <DataListItem
              label="Account settings"
              description="Manage your preferences"
              icon={<Settings className="w-4 h-4" />}
              chevron
            />
            <DataListItem
              label="Team member"
              description="jane@example.com"
              icon={<User className="w-4 h-4" />}
              action={
                <Button size="icon" variant="ghost" aria-label="Remove">
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              }
            />
          </DataList>
        </div>
      </Section>

      <Section title="DataGrid — responsive card grid">
        <DataGrid minWidth={200} gap="3">
          {["Website", "Mobile App", "API", "Dashboard", "Analytics", "Onboarding"].map((name) => (
            <Card key={name} className="p-4">
              <p className="text-sm font-semibold text-foreground">{name}</p>
              <p className="text-xs text-muted-foreground mt-1">Active project</p>
            </Card>
          ))}
        </DataGrid>
      </Section>

      <Section title="MetadataList — key/value details">
        <Inline gap="8" wrap>
          <Stack gap="2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              1 column
            </p>
            <MetadataList
              items={[
                { label: "Project", value: "Website Redesign" },
                { label: "Status", value: <Badge variant="accent">Active</Badge> },
                { label: "Owner", value: "Jane Smith" },
                { label: "Due date", value: "May 15, 2026" },
              ]}
            />
          </Stack>
          <Stack gap="2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              2 columns
            </p>
            <MetadataList
              columns={2}
              items={[
                { label: "Project", value: "Mobile App" },
                { label: "Status", value: <Badge variant="success">Done</Badge> },
                { label: "Tasks", value: "34" },
                { label: "Owner", value: "Alex Johnson" },
                { label: "Created", value: "Jan 3, 2026" },
                { label: "Due date", value: "Apr 30, 2026" },
              ]}
            />
          </Stack>
        </Inline>
      </Section>
    </Page>
  )
}
