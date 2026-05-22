import { useState } from "react"
import {
  Page, PageHeader, Section, Stack, Inline,
  ActionSurface, ActionBar, BottomActionBar,
  ConfirmAction, SheetOrPopover,
  Button, DataList, DataListItem,
  toast,
} from "@chromatis/base"
import { Trash2, Edit, Download, MoreHorizontal, Bell, Star, Share2 } from "lucide-react"

export default function InteractionDemo() {
  const [items, setItems] = useState(["Report Q1.pdf", "Slides.pptx", "Budget.xlsx"])

  function removeItem(name: string) {
    setItems((prev) => prev.filter((i) => i !== name))
    toast.success(`Deleted ${name}`)
  }

  return (
    <Page title="Interaction">
      <PageHeader title="Interaction" subtitle="ActionSurface, ActionBar, BottomActionBar, ConfirmAction, SheetOrPopover" />

      <Section title="ActionSurface — pressable rows">
        <div className="border border-border rounded-2xl overflow-hidden max-w-sm">
          <Stack gap="1">
            {["Dashboard", "Projects", "Settings"].map((label) => (
              <ActionSurface
                key={label}
                onClick={() => { toast(`Tapped ${label}`) }}
              >
                <div className="px-4 py-3 text-sm font-medium">{label}</div>
              </ActionSurface>
            ))}
          </Stack>
        </div>
      </Section>

      <Section title="ActionBar — horizontal scrollable toolbar">
        <div className="border border-border rounded-2xl p-4">
          <ActionBar>
            <Button variant="outline" size="sm">
              <Bell className="w-4 h-4" /> Notify
            </Button>
            <Button variant="outline" size="sm">
              <Star className="w-4 h-4" /> Star
            </Button>
            <Button variant="outline" size="sm">
              <Share2 className="w-4 h-4" /> Share
            </Button>
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4" /> Export
            </Button>
            <Button variant="outline" size="sm">
              <Edit className="w-4 h-4" /> Edit
            </Button>
          </ActionBar>
        </div>
      </Section>

      <Section title="ConfirmAction — wraps any trigger with a confirmation dialog">
        <Inline gap="3" wrap>
          <ConfirmAction
            trigger={<Button variant="outline">Delete item</Button>}
            title="Delete item?"
            description="This action cannot be undone."
            confirmLabel="Delete"
            variant="destructive"
            onConfirm={() => { toast.error("Item deleted") }}
          />
          <ConfirmAction
            trigger={<Button>Publish</Button>}
            title="Publish changes?"
            description="This will make your changes visible to all users."
            confirmLabel="Publish"
            onConfirm={async () => {
              await new Promise((r) => setTimeout(r, 1000))
              toast.success("Published!")
            }}
          />
        </Inline>
      </Section>

      <Section title="SheetOrPopover — Sheet on mobile, Popover on desktop">
        <Inline gap="3" wrap>
          <SheetOrPopover
            trigger={<Button variant="outline" size="icon"><MoreHorizontal className="w-4 h-4" /></Button>}
            sheetTitle="Actions"
          >
            <Stack gap="1">
              <button
                type="button"
                className="flex items-center gap-2 px-4 py-3 text-sm hover:bg-muted/60 transition-colors w-full text-left"
                onClick={() => toast("Edit clicked")}
              >
                <Edit className="w-4 h-4" /> Edit
              </button>
              <button
                type="button"
                className="flex items-center gap-2 px-4 py-3 text-sm hover:bg-muted/60 transition-colors w-full text-left"
                onClick={() => toast("Download clicked")}
              >
                <Download className="w-4 h-4" /> Download
              </button>
              <button
                type="button"
                className="flex items-center gap-2 px-4 py-3 text-sm text-destructive hover:bg-destructive/10 transition-colors w-full text-left"
                onClick={() => toast.error("Delete clicked")}
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </Stack>
          </SheetOrPopover>
          <p className="text-sm text-muted-foreground self-center">Click the ··· button (Sheet on mobile, popover on desktop)</p>
        </Inline>
      </Section>

      <Section title="ConfirmAction on list items">
        <div className="max-w-sm">
          <DataList>
            {items.map((name) => (
              <DataListItem
                key={name}
                label={name}
                icon={<Download className="w-4 h-4" />}
                action={
                  <ConfirmAction
                    trigger={
                      <Button size="icon" variant="ghost" aria-label={`Delete ${name}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    }
                    title={`Delete ${name}?`}
                    description="This file will be permanently removed."
                    confirmLabel="Delete"
                    variant="destructive"
                    onConfirm={() => removeItem(name)}
                  />
                }
              />
            ))}
          </DataList>
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">All items deleted.</p>
          )}
        </div>
      </Section>

      <Section title="BottomActionBar — fixed to bottom on mobile only (md:hidden)">
        <p className="text-sm text-muted-foreground">
          Resize to mobile width to see the bar pinned to the bottom of the viewport.
        </p>
        <BottomActionBar>
          <Button className="flex-1">Save draft</Button>
          <Button variant="outline" className="flex-1">Preview</Button>
        </BottomActionBar>
      </Section>
    </Page>
  )
}
