import { runAdAccountSync } from "@tharros/ads-shared/sync";

/** Meta pull entry for ads/account.sync when platform is meta. Connector stays in @tharros/ads-shared. */
export function pullMetaAdAccount(adAccountId: string) {
  return runAdAccountSync(adAccountId);
}
