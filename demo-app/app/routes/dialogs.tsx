import { useState } from "react"
import {
  Page, PageHeader, Section, Inline, Stack,
  Button,
  Dialog, DialogTrigger, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter, DialogClose, DialogBody,
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetFooter,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@platform/framework"

export default function DialogsDemo() {
  const [tab, setTab] = useState("details")

  return (
    <Page title="Dialogs & Sheets">
      <PageHeader title="Dialogs & Sheets" subtitle="Dialog, Sheet, Tabs" />

      <Section title="Dialog">
        <Inline gap="3" wrap>
          <Dialog open={false} onOpenChange={() => {}}>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm action</DialogTitle>
                <DialogDescription>
                  This is a centered modal dialog. Press Escape or click outside to close.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <p className="text-sm text-muted-foreground">
                  Dialog body content goes here. It scrolls if needed.
                </p>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button>Confirm</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={false} onOpenChange={() => {}}>
            <DialogTrigger asChild>
              <Button variant="destructive">Destructive dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete project?</DialogTitle>
                <DialogDescription>
                  This will permanently delete the project and all its tasks. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Cancel</Button>
                </DialogClose>
                <Button variant="destructive">Delete</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Inline>
      </Section>

      <Section title="Sheet — sides">
        <Inline gap="3" wrap>
          {(["bottom", "right", "left"] as const).map((side) => (
            <Sheet key={side} open={false} onOpenChange={() => {}}>
              <SheetTrigger asChild>
                <Button variant="outline">{side} sheet</Button>
              </SheetTrigger>
              <SheetContent side={side}>
                <SheetHeader>
                  <SheetTitle>{side.charAt(0).toUpperCase() + side.slice(1)} Sheet</SheetTitle>
                </SheetHeader>
                <div className="flex-1 p-4">
                  <p className="text-sm text-muted-foreground">Sheet content. Swipe or press Escape to close.</p>
                </div>
                <SheetFooter>
                  <Button className="w-full">Done</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          ))}
        </Inline>
      </Section>

      <Section title="Tabs">
        <Tabs value={tab} onChange={setTab}>
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="details">
            <Stack gap="2">
              <p className="text-sm text-muted-foreground">Details tab. Content is only rendered when active (no hidden panels).</p>
            </Stack>
          </TabsContent>
          <TabsContent value="activity">
            <p className="text-sm text-muted-foreground">Activity tab content.</p>
          </TabsContent>
          <TabsContent value="settings">
            <p className="text-sm text-muted-foreground">Settings tab content.</p>
          </TabsContent>
        </Tabs>
      </Section>
    </Page>
  )
}
