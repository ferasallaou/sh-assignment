import { Module } from '@nestjs/common';
import { EngineeringJsonConnector } from './engineering-json.connector';
import { ProductMarkdownConnector } from './product-markdown.connector';
import { SalesCsvConnector } from './sales-csv.connector';
import type { SourceConnector } from '../types';

/** Injection token for the list of all source connectors. */
export const SOURCE_CONNECTORS = Symbol('SOURCE_CONNECTORS');

/**
 * Registers every source connector.
 * Adding a department means writing one connector class and adding it to this list;
 * sync, storage and access control don't change.
 */
@Module({
  providers: [
    {
      provide: SOURCE_CONNECTORS,
      useFactory: (): SourceConnector[] => [
        new SalesCsvConnector(),
        new EngineeringJsonConnector(),
        new ProductMarkdownConnector(),
      ],
    },
  ],
  exports: [SOURCE_CONNECTORS],
})
export class ConnectorsModule {}
