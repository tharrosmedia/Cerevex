import type { AuthContext } from "@tharros/shared";

export type AppEnv = {
  Variables: {
    requestId: string;
    auth: AuthContext;
  };
};
