export type User = Readonly<{ id: string }>;

export type Session = Readonly<{
  id: string;
  user: User;
  expiresAt: Date;
}>;

export type LoginResult =
  | Readonly<{ status: "ok"; user: User }>
  | Readonly<{ status: "invalid_credentials" | "disabled" }>;

export type RegisterResult =
  | Readonly<{ status: "registered"; user: User }>
  | Readonly<{ status: "pending_approval" | "username_taken" }>;

export type ExternalIdentity = Readonly<{
  providerId: string;
  externalId: string;
  email: string | null;
  displayName: string;
  raw: Readonly<Record<string, unknown>>;
}>;

export interface SSOProvider {
  initiate(request: Request): Promise<Response>;
  handleCallback(request: Request): Promise<ExternalIdentity>;
}
