export type UserRole = "admin" | "user";

export type UserDTO = {
  id: string;
  role: UserRole;
};

export type Session<U extends UserDTO = UserDTO> = { user: U };

export type LoginResult =
  | { status: "ok"; user: UserDTO }
  | { status: "invalid_credentials" }
  | { status: "disabled" };

export type RegisterResult =
  | { status: "registered"; user: UserDTO }
  | { status: "pending_approval" }
  | { status: "username_taken" };
