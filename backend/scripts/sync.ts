/**
 * Runs one sync of every source into the knowledge base and prints what changed.
 * Stands in for the production triggers (webhooks, schedules, nightly reconciliation),
 * which would all call the same SyncService.
 *
 * Usage: npm run sync
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SyncService } from '../src/sync/sync.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const report = await app.get(SyncService).syncAll();

    console.table(
      report.sources.map((s) => ({
        source: s.source,
        status: s.status,
        added: s.added,
        updated: s.updated,
        'perms/meta only': s.updatedWithoutRechunk,
        unchanged: s.unchanged,
        deleted: s.deleted,
      })),
    );
    for (const source of report.sources) {
      if (source.error) console.error(`✖ ${source.source}: ${source.error}`);
      for (const warning of source.warnings) console.warn(`! ${source.source}: ${warning}`);
    }
    console.log(
      `Embedded ${report.chunksEmbedded} chunks, ${report.chunksWaitingForEmbedding} waiting for embeddings.`,
    );
    if (report.embeddingError) console.error(`✖ embeddings: ${report.embeddingError}`);

    if (report.sources.some((s) => s.status === 'failed')) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
