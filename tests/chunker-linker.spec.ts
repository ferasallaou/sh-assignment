/** Step 4 unit checks: chunking and deterministic feature linking. */
import { splitIntoChunks } from '../src/sync/chunker';
import { linkRecordToFeatures } from '../src/sync/entity-linker';
import { loadFeatureCatalog } from '../src/knowledge/feature-catalog';
import type { SourceRecord } from '../src/connectors/source-connector';

const catalog = loadFeatureCatalog();

function record(overrides: Partial<SourceRecord>): SourceRecord {
  return {
    externalId: 'X-1',
    title: 'Title',
    content: '',
    metadata: {},
    allowedGroups: ['product'],
    explicitFeatureKeys: [],
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

describe('splitIntoChunks', () => {
  it('keeps a short record as one chunk that starts with the title', () => {
    expect(splitIntoChunks('Brief', 'One paragraph.')).toEqual(['Brief\n\nOne paragraph.']);
  });

  it('packs paragraphs into chunks no longer than the limit', () => {
    const paragraph = 'x'.repeat(300);
    const chunks = splitIntoChunks('T', [paragraph, paragraph, paragraph].join('\n\n'), 700);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.startsWith('T\n\n'))).toBe(true);
  });

  it('never returns zero chunks', () => {
    expect(splitIntoChunks('Only a title', '   ')).toEqual(['Only a title']);
  });
});

describe('linkRecordToFeatures', () => {
  it('links by explicit ID first', () => {
    const result = linkRecordToFeatures(record({ explicitFeatureKeys: ['dark-mode'], content: 'dark mode' }), catalog);
    expect(result.links).toEqual([{ featureKey: 'dark-mode', matchedBy: 'id' }]);
  });

  it('links by alias when there is no ID, ignoring case', () => {
    const result = linkRecordToFeatures(record({ content: 'Asked for a Night Mode on the dashboard.' }), catalog);
    expect(result.links).toEqual([{ featureKey: 'dark-mode', matchedBy: 'alias' }]);
  });

  it('finds several features in one document', () => {
    const result = linkRecordToFeatures(record({ content: 'Okta login, then dark theme, then CSV export.' }), catalog);
    expect(result.links.map((link) => link.featureKey).sort()).toEqual(['bulk-export', 'dark-mode', 'sso']);
  });

  it('matches whole phrases only', () => {
    const result = linkRecordToFeatures(record({ content: 'The csv exporter library is slow.' }), catalog);
    expect(result.links).toEqual([]);
  });

  it('reports explicit IDs that are not in the catalog instead of linking them', () => {
    const result = linkRecordToFeatures(record({ explicitFeatureKeys: ['teleport'] }), catalog);
    expect(result).toEqual({ links: [], unknownFeatureKeys: ['teleport'] });
  });
});
