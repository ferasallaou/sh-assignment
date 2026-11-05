import { join } from 'node:path';
import { MarkdownDocsConnector } from './product-markdown.connector';

const DEFAULT_DIR = join(__dirname, '..', '..', 'data', 'sources', 'hr');

/**
 * HR policy documents (leave, expenses, ...). These are copied in like any other document.
 * Personal HR data (leave balances, salaries) is NOT synced: it is fetched live, see src/hr/.
 */
export class HrMarkdownConnector extends MarkdownDocsConnector {
  constructor(dir: string = DEFAULT_DIR) {
    super('hr', dir);
  }
}
