/** A record ID like S-101, coloured by the department it came from. */
export function RecordChip({ id, muted = false, title }: { id: string; muted?: boolean; title?: string }) {
  return (
    <span
      className={`chip chip-${sourceOf(id)}${muted ? ' chip-muted' : ''}`}
      title={title ?? SOURCE_NAMES[sourceOf(id)]}
    >
      {id}
    </span>
  );
}

export function sourceOf(id: string): 'sales' | 'engineering' | 'product' | 'hr' | 'live' | 'other' {
  if (id.startsWith('S-')) return 'sales';
  if (id.startsWith('ENG-')) return 'engineering';
  if (id.startsWith('PRD-')) return 'product';
  if (id.startsWith('HRIS-')) return 'live';
  if (id.startsWith('HR-')) return 'hr';
  return 'other';
}

const SOURCE_NAMES = {
  sales: 'Sales',
  engineering: 'Engineering',
  product: 'Product',
  hr: 'HR policy',
  live: 'Live from the HR system',
  other: 'Other',
};
