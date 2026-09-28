import { runAdAccountSync } from "@tharros/ads-shared/sync";

/** Google pull entry for ads/account.sync when platform is google. Connector stays in @tharros/ads-shared. */
export function pullGoogleAdAccount(adAccountId: string) {
  return runAdAccountSync(adAccountId);
}
