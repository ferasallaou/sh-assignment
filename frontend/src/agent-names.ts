/** Friendly names for the assistants, as people at the company would call them. */
const NAMES: Record<string, string> = {
  'roadmap-agent': 'Roadmap',
  'product-faq-agent': 'Product FAQ',
  'hr-agent': 'HR',
};

export function agentName(id: string): string {
  return `${NAMES[id] ?? id} assistant`;
}

/** "A", "A or B", "A, B or C" */
export function joinOr(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}
