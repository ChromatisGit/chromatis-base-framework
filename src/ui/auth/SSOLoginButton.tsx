import { Button } from "../primitives/Button.js";

export interface SSOLoginButtonProps {
  readonly href: string;
  readonly providerName: string;
  readonly disabled?: boolean;
}

export function SSOLoginButton({
  href,
  providerName,
  disabled = false,
}: SSOLoginButtonProps) {
  return (
    <Button
      variant="outline"
      size="lg"
      className="w-full"
      disabled={disabled}
      onClick={() => window.location.assign(href)}
    >
      Continue with {providerName}
    </Button>
  );
}
