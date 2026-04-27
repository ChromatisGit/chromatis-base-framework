import { useState } from "react"
import {
  Page, PageHeader, Section,
  Form, FormSection, TextField, TextAreaField,
  SelectField, SwitchField, CheckboxField, FormActions,
  Button, Stack,
} from "@platform/framework"

export default function FormsDemo() {
  const [notifications, setNotifications] = useState(true)
  const [newsletter, setNewsletter] = useState(false)

  return (
    <Page title="Forms">
      <PageHeader title="Forms" subtitle="All form components with form context (auto-disables on submit)" />

      <Section title="Create Project">
        <Form method="post" action="#">
          <FormSection title="Details">
            <Stack gap="4">
              <TextField
                label="Project name"
                name="name"
                placeholder="My awesome project"
              />
              <TextAreaField
                label="Description"
                name="description"
                placeholder="What is this project about?"
                hint="Keep it brief — one or two sentences."
              />
              <SelectField
                label="Status"
                name="status"
                options={[
                  { value: "active", label: "Active" },
                  { value: "paused", label: "Paused" },
                  { value: "done", label: "Done" },
                ]}
                placeholder="Choose a status"
              />
              <TextField
                label="Due date"
                name="due"
                type="date"
              />
              <TextField
                label="This field has an error"
                name="broken"
                defaultValue="bad value"
                error="This value is not valid."
              />
            </Stack>
          </FormSection>

          <FormSection title="Preferences">
            <Section variant="settings">
              <SwitchField
                label="Email notifications"
                description="Get notified when tasks are updated."
                checked={notifications}
                onChange={setNotifications}
              />
              <SwitchField
                label="Newsletter"
                description="Weekly digest of activity."
                checked={newsletter}
                onChange={setNewsletter}
              />
              <CheckboxField
                label="I agree to the terms"
                description="By checking this you accept the terms of service."
                name="terms"
              />
            </Section>
          </FormSection>

          <FormActions>
            <Button variant="ghost">Cancel</Button>
            <Button type="submit">Create project</Button>
          </FormActions>
        </Form>
      </Section>
    </Page>
  )
}
