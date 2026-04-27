import { useState } from "react"
import {
  Page, PageHeader, Section, Stack, Inline,
  Button, Badge, Card, Input, Switch, Checkbox, Select,
} from "@platform/framework"
import { Plus, Trash2, Download } from "lucide-react"

export default function PrimitivesDemo() {
  const [sw, setSw] = useState(false)
  const [checked, setChecked] = useState(false)

  return (
    <Page title="Primitives">
      <PageHeader title="Primitives" subtitle="Button, Badge, Card, Input, Switch, Checkbox, Select" />

      <Section title="Button — variants">
        <Inline gap="3" wrap>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button disabled>Disabled</Button>
        </Inline>
      </Section>

      <Section title="Button — sizes">
        <Inline gap="3" align="center" wrap>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="outline"><Plus className="w-4 h-4" /></Button>
        </Inline>
      </Section>

      <Section title="Button — with icons">
        <Inline gap="3" wrap>
          <Button><Plus className="w-4 h-4" /> New project</Button>
          <Button variant="outline"><Download className="w-4 h-4" /> Export</Button>
          <Button variant="destructive"><Trash2 className="w-4 h-4" /> Delete</Button>
        </Inline>
      </Section>

      <Section title="Badge — variants">
        <Inline gap="2" wrap>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="accent">Accent</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </Inline>
      </Section>

      <Section title="Card — tones">
        <Inline gap="4" wrap>
          <Card className="p-5 w-48">
            <p className="text-sm font-medium">Default</p>
            <p className="text-xs text-muted-foreground mt-1">tone="default"</p>
          </Card>
          <Card tone="muted" className="p-5 w-48">
            <p className="text-sm font-medium">Muted</p>
            <p className="text-xs text-muted-foreground mt-1">tone="muted"</p>
          </Card>
          <Card tone="accent" className="p-5 w-48">
            <p className="text-sm font-medium">Accent</p>
            <p className="text-xs text-muted-foreground mt-1">tone="accent"</p>
          </Card>
          <Card interactive className="p-5 w-48">
            <p className="text-sm font-medium">Interactive</p>
            <p className="text-xs text-muted-foreground mt-1">hover me</p>
          </Card>
        </Inline>
      </Section>

      <Section title="Input">
        <Stack gap="4" className="max-w-sm">
          <Input label="Default" placeholder="Enter value" />
          <Input label="With hint" placeholder="Enter email" hint="We'll never share your email." />
          <Input label="With error" defaultValue="bad@" error="Enter a valid email address." />
          <Input label="Disabled" defaultValue="Can't touch this" disabled />
        </Stack>
      </Section>

      <Section title="Switch &amp; Checkbox">
        <Stack gap="4" className="max-w-sm">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-medium">Toggle switch</span>
            <Switch checked={sw} onChange={setSw} />
          </div>
          <Checkbox
            label="Accept terms"
            description="By checking you agree to our terms of service."
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
        </Stack>
      </Section>

      <Section title="Select">
        <Stack gap="4" className="max-w-sm">
          <Select
            label="Framework"
            options={[
              { value: "rr7", label: "React Router 7" },
              { value: "next", label: "Next.js" },
              { value: "remix", label: "Remix" },
            ]}
            placeholder="Pick one"
          />
        </Stack>
      </Section>
    </Page>
  )
}
