/**
 * The only production migrate command for schema os.
 * Documented in apps/ads/README.md under Production migrate.
 *
 * PRODUCTION_NEON_HOST=<neon-host> DATABASE_URL='<prod-url>' npm run ads:db:migrate:prod -- --host <neon-host> --confirm
 *
 * Does not print DATABASE_URL. Does not seed. Does not apply Brain public migrations.
 */
import {
  parseProdMigrateArgs,
  ProdMigrateError,
  redactDatabaseUrl,
  runOsProdMigrate,
  type ProdMigratePlan,
} from "./prod-migrate";

export { parseProdMigrateArgs };

function printResult(body: Record<string, unknown>): void {
  console.log(JSON.stringify(body));
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const productionNeonHost = process.env.PRODUCTION_NEON_HOST ?? "";
  let plan: ProdMigratePlan | null = null;
  try {
    const args = parseProdMigrateArgs(process.argv.slice(2));
    if (!databaseUrl.trim()) {
      throw new ProdMigrateError("Refusing to migrate. DATABASE_URL is required.");
    }
    if (!productionNeonHost.trim()) {
      throw new ProdMigrateError("Refusing to migrate. Set PRODUCTION_NEON_HOST to the prod Neon host.");
    }
    const report = await runOsProdMigrate({
      databaseUrl,
      productionNeonHost,
      host: args.host,
      mode: args.mode,
    });
    printResult(report);
  } catch (error) {
    if (error instanceof ProdMigrateError) plan = error.plan;
    const message = error instanceof Error ? error.message : String(error);
    printResult({
      ok: false,
      error: redactDatabaseUrl(message, databaseUrl),
      ...(plan ? { host: plan.host, applied: plan.applied, pending: plan.pending, problems: plan.problems } : {}),
      migrationsApplied: [],
    });
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && (entry.endsWith("prod-migrate-cli.ts") || entry.endsWith("prod-migrate-cli.js"))) {
  void main();
}
