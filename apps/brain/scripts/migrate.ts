import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = neon(process.env.DATABASE_URL!);

async function migrate() {
  const dir = join(__dirname, '../db/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const filePath = join(dir, file);
    const content = readFileSync(filePath, 'utf-8');
    console.log('Running migration: ' + file);
    await (sql as any)([content]);
    console.log('Completed: ' + file);
  }
  console.log('Migrations complete');
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
