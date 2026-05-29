import { useNavigation } from "react-router";
import { Card } from "../primitives/Card.js";
import { Input } from "../primitives/Input.js";
import { Button } from "../primitives/Button.js";
import { CenteredLayout } from "../layouts/CenteredLayout.js";
import { Form } from "../forms/Form.js";

interface RegisterFormProps {
  status?: "pending_approval" | "username_taken" | "pin_mismatch" | (string & {});
  title?: string;
  submitLabel?: string;
}

export function RegisterForm({
  status,
  title = "Create account",
  submitLabel = "Create account",
}: RegisterFormProps) {
  const navigation = useNavigation();
  const isPending = navigation.state === "submitting";

  if (status === "pending_approval") {
    return (
      <CenteredLayout maxWidth={400}>
        <Card className="p-6 flex flex-col gap-4">
          <h1 className="text-xl font-semibold text-foreground">Account created</h1>
          <p className="text-sm text-muted-foreground">
            Your account was successfully created. An administrator needs to enable it before you
            can sign in.
          </p>
          <a
            href="/login"
            className="text-sm text-primary hover:underline text-center"
          >
            Back to sign in
          </a>
        </Card>
      </CenteredLayout>
    );
  }

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
            {...(status === "username_taken" ? { error: "This username is already taken." } : {})}
          />
          <Input
            label="PIN"
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            required
            disabled={isPending}
          />
          <Input
            label="Confirm PIN"
            name="confirmPin"
            type="password"
            inputMode="numeric"
            autoComplete="new-password"
            required
            disabled={isPending}
            {...(status === "pin_mismatch" ? { error: "PINs do not match." } : {})}
          />
          <Button type="submit" size="lg" className="w-full mt-1" disabled={isPending}>
            {isPending ? "Creating account…" : submitLabel}
          </Button>
        </Form>
        <a href="/login" className="text-sm text-muted-foreground hover:text-foreground text-center">
          Already have an account? Sign in
        </a>
      </Card>
    </CenteredLayout>
  );
}
