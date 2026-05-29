import { useNavigation } from "react-router";
import { Card } from "../primitives/Card.js";
import { Input } from "../primitives/Input.js";
import { Button } from "../primitives/Button.js";
import { CenteredLayout } from "../layouts/CenteredLayout.js";
import { Form } from "../forms/Form.js";

const errorMessages: Record<string, string> = {
  invalid_credentials: "Incorrect username or PIN.",
  disabled: "Your account is not enabled. Please contact an administrator.",
};

interface LoginFormProps {
  error?: string;
  title?: string;
  submitLabel?: string;
}

export function LoginForm({
  error,
  title = "Sign in",
  submitLabel = "Sign in",
}: LoginFormProps) {
  const navigation = useNavigation();
  const isPending = navigation.state === "submitting";

  return (
    <CenteredLayout maxWidth={400}>
      <Card className="p-6 flex flex-col gap-5">
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        <Form method="post" className="flex flex-col gap-4">
          <Input
            label="Username"
            name="username"
            autoComplete="username"
            required
            disabled={isPending}
          />
          <Input
            label="PIN"
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            required
            disabled={isPending}
            {...(error ? { error: errorMessages[error] ?? error } : {})}
          />
          <Button type="submit" size="lg" className="w-full mt-1" disabled={isPending}>
            {isPending ? "Signing in…" : submitLabel}
          </Button>
        </Form>
      </Card>
    </CenteredLayout>
  );
}
