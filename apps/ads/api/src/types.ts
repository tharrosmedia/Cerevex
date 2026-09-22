import type { AuthContext } from "@tharros/ads-shared";

export type AppEnv = {
  Variables: {
    requestId: string;
    auth: AuthContext;
  };
};
