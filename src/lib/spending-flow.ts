//
// Pure shaping of the server's spending Sankey data for display. Kept apart
// from the chart component so the rules are unit-testable without rendering.

export interface FlowNode {
  name: string;
  color?: string;
  /** Category id; null for the uncategorized "Other" node; absent for accounts. */
  categoryId?: string | null;
}

export interface FlowLink {
  source: number;
  target: number;
  value: number;
}

export interface PreparedFlowNode {
  name: string;
  color: string | undefined;
  /** Copied from the source node when present (see FlowNode.categoryId). */
  categoryId?: string | null;
  /** 0 = account, 1 = category, 2 = subcategory. */
  depth: number;
  /** Money through the node, in minor units. */
  total: number;
  /** total / all spending, 0..1. */
  share: number;
}

export interface PreparedFlow {
  nodes: PreparedFlowNode[];
  links: FlowLink[];
  totalSpent: number;
  /** Number of columns actually drawn (2 or 3). */
  columns: number;
  /** Node count of the busiest column, used to size the chart height. */
  largestColumn: number;
}

/**
 * The server balances every category by sending its direct spending to a
 * "subcategory" node with the same name (Groceries -> Groceries). When that
 * repeat is the category's only outgoing band it carries no information, so
 * it is dropped: the category simply ends there. Repeats next to real
 * subcategories are kept, because they show the part spent directly on the
 * parent.
 */
export function prepareSpendingFlow(
  nodes: FlowNode[],
  links: FlowLink[],
): PreparedFlow {
  const outgoing = new Map<number, FlowLink[]>();
  const incoming = new Map<number, FlowLink[]>();
  for (const link of links) {
    outgoing.set(link.source, [...(outgoing.get(link.source) ?? []), link]);
    incoming.set(link.target, [...(incoming.get(link.target) ?? []), link]);
  }

  const isRepeat = (link: FlowLink): boolean =>
    nodes[link.source]?.name === nodes[link.target]?.name &&
    (incoming.get(link.source)?.length ?? 0) > 0 &&
    (outgoing.get(link.source)?.length ?? 0) === 1 &&
    (incoming.get(link.target)?.length ?? 0) === 1 &&
    (outgoing.get(link.target)?.length ?? 0) === 0;

  const keptLinks = links.filter((link) => link.value > 0 && !isRepeat(link));

  // Reindex so nodes left without any band are not drawn.
  const usedIndexes = [...new Set(keptLinks.flatMap((link) => [link.source, link.target]))].sort(
    (a, b) => a - b,
  );
  const newIndex = new Map(usedIndexes.map((oldIndex, position) => [oldIndex, position]));
  const remappedLinks = keptLinks.flatMap((link) => {
    const source = newIndex.get(link.source);
    const target = newIndex.get(link.target);
    return source === undefined || target === undefined
      ? []
      : [{ source, target, value: link.value }];
  });

  const depths = computeDepths(usedIndexes.length, remappedLinks);
  const inTotal = new Map<number, number>();
  const outTotal = new Map<number, number>();
  for (const link of remappedLinks) {
    outTotal.set(link.source, (outTotal.get(link.source) ?? 0) + link.value);
    inTotal.set(link.target, (inTotal.get(link.target) ?? 0) + link.value);
  }
  const totalSpent = remappedLinks
    .filter((link) => depths[link.source] === 0)
    .reduce((sum, link) => sum + link.value, 0);

  const preparedNodes = usedIndexes.map((oldIndex, position): PreparedFlowNode => {
    const total = Math.max(inTotal.get(position) ?? 0, outTotal.get(position) ?? 0);
    const categoryId = nodes[oldIndex]?.categoryId;
    return {
      name: nodes[oldIndex]?.name ?? "",
      color: nodes[oldIndex]?.color,
      ...(categoryId === undefined ? {} : { categoryId }),
      depth: depths[position] ?? 0,
      total,
      share: totalSpent > 0 ? total / totalSpent : 0,
    };
  });

  const columnSizes = new Map<number, number>();
  for (const node of preparedNodes) {
    columnSizes.set(node.depth, (columnSizes.get(node.depth) ?? 0) + 1);
  }

  return {
    nodes: preparedNodes,
    links: remappedLinks,
    totalSpent,
    columns: columnSizes.size,
    largestColumn: Math.max(0, ...columnSizes.values()),
  };
}

/** Longest-path depth from the source nodes; bounded by the node count so a
 * malformed cycle cannot loop forever. */
function computeDepths(nodeCount: number, links: FlowLink[]): number[] {
  const depths = Array.from({ length: nodeCount }, () => 0);
  for (let pass = 0; pass < nodeCount; pass++) {
    let changed = false;
    for (const link of links) {
      const candidate = (depths[link.source] ?? 0) + 1;
      if (candidate > (depths[link.target] ?? 0)) {
        depths[link.target] = candidate;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depths;
}
