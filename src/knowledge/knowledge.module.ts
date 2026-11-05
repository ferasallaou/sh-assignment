import { Module } from '@nestjs/common';
import { loadFeatureCatalog } from './feature-catalog';

/** Injection token for the feature catalog (the entities records are linked to). */
export const FEATURE_CATALOG = Symbol('FEATURE_CATALOG');

@Module({
  providers: [{ provide: FEATURE_CATALOG, useFactory: () => loadFeatureCatalog() }],
  exports: [FEATURE_CATALOG],
})
export class KnowledgeModule {}
