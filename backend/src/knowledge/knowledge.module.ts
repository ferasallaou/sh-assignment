import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module';
import { loadFeatureCatalog } from './feature-catalog';
import { KnowledgeSearchService } from './knowledge-search.service';

/** Injection token for the feature catalog (the entities records are linked to). */
export const FEATURE_CATALOG = Symbol('FEATURE_CATALOG');

@Module({
  imports: [ProvidersModule],
  providers: [{ provide: FEATURE_CATALOG, useFactory: () => loadFeatureCatalog() }, KnowledgeSearchService],
  exports: [FEATURE_CATALOG, KnowledgeSearchService],
})
export class KnowledgeModule {}
