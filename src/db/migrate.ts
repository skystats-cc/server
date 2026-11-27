import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client.js';
import { logger } from '../lib/logger.js';

await migrate(db, { migrationsFolder: 'drizzle' });
logger.info('migrations applied');
await sql.end();
