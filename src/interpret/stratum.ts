import type { ImportEdge } from '../types.js';
import type { DirectoryNode } from '../directory-tree.js';
import type { Atom } from './atoms/resolve.js';
import type { Compound, Reference } from './atoms/references.js';
import type { Breadcrumb, AtomDiff } from './atoms/prompt.js';
import { buildClusterPrompt } from './atoms/prompt.js';
import { compoundId, sourceHash } from './atoms/ids.js';
import { validateStratum, type ZoomConfig } from './atoms/validate.js';
import { fallbackStratum } from './atoms/fallback.js';
import { structuralPartition } from './partition.js';
import { computeQuality, type StratumQuality } from './quality.js';

export interface StratumRelationship {
  sourceId: string;
  targetId: string;
  kind: 'depends-on' | 'extends' | 'uses';
  edgeCount: number;
}

export interface Stratum {
  depth: number;
  parentCompoundId: string | null;
  compounds: Compound[];
  relationships: StratumRelationship[];
  breadcrumbs: Breadcrumb[];
  sourceHash: string;
  quality: StratumQuality;
  generatedAt: string;
}

export interface LLMResponse {
  content: unknown;
  usage: { promptTokens: number; completionTokens: number };
}

export interface LLMClient {
  complete(prompt: string, responseSchema: object): Promise<LLMResponse>;
}

export interface StratumCache {
  get(projectId: string, parentCompoundId: string, atomType: string): { stratum: Stratum; stale: boolean } | null;
  set(projectId: string, parentCompoundId: string, atomType: string, stratum: Stratum): void;
  invalidateDescendants(projectId: string, compoundId: string): number;
  clear(projectId: string): void;
}

export async function buildStratum(
  parent: Compound | null,
  atoms: Atom[],
  edges: ImportEdge[],
  breadcrumbs: Breadcrumb[],
  config: ZoomConfig,
  llm: LLMClient,
  cache: StratumCache,
  projectId: string,
  atomType: string,
): Promise<Stratum> {
  const depth = breadcrumbs.length;
  const parentCompoundId = parent?.id ?? 'root';
  const currentSourceHash = sourceHash(atoms, edges);

  // Build breadcrumbs for the result
  const resultBreadcrumbs: Breadcrumb[] = [...breadcrumbs];
  if (depth === 0) {
    resultBreadcrumbs.unshift({ compoundId: 'root', compoundName: 'Project Root', depth: 0 });
  }

  // Check if atoms.length < minCompoundSize -> single leaf compound
  if (atoms.length < config.minCompoundSize) {
    const atomIds = atoms.map((a) => a.id);
    const leafCompound: Compound = {
      id: compoundId(atomIds),
      name: 'Leaf',
      summary: 'Single leaf compound',
      atomIds,
      references: [],
      zoomable: false,
    };
    const stratum: Stratum = {
      depth,
      parentCompoundId: parent ? parent.id : null,
      compounds: [leafCompound],
      relationships: [],
      breadcrumbs: resultBreadcrumbs,
      sourceHash: currentSourceHash,
      quality: computeQuality([leafCompound], edges, atoms, 'llm'),
      generatedAt: new Date().toISOString(),
    };
    cache.set(projectId, parentCompoundId, atomType, stratum);
    return stratum;
  }

  // Check cache — only use cached result if sourceHash matches AND quality
  // source is 'llm'. Fallback results (structural/directory/flat) should be
  // re-attempted so the LLM gets another chance when it's available.
  const cached = cache.get(projectId, parentCompoundId, atomType);
  if (cached && cached.stratum.sourceHash === currentSourceHash && cached.stratum.quality.source === 'llm') {
    return cached.stratum;
  }

  // Determine if we should use differential prompt
  let prevClustering: { compounds: Compound[] } | null = null;
  let atomDiff: AtomDiff | null = null;

  if (cached && cached.stratum.sourceHash !== currentSourceHash && cached.stratum.quality.source === 'llm') {
    // Only use LLM-quality cached results for differential re-clustering
    const cachedAtomIds = new Set(cached.stratum.compounds.flatMap((c) => c.atomIds));
    const currentAtomIds = new Set(atoms.map((a) => a.id));

    const added = [...currentAtomIds].filter((id) => !cachedAtomIds.has(id));
    const removed = [...cachedAtomIds].filter((id) => !currentAtomIds.has(id));
    const totalAtoms = Math.max(cachedAtomIds.size, currentAtomIds.size);
    const changeRatio = (added.length + removed.length) / totalAtoms;

    if (changeRatio <= 0.2) {
      prevClustering = { compounds: cached.stratum.compounds };
      atomDiff = { added, removed, edgesChanged: 0 };
    }
  }

  // Check depth >= maxStratumDepth -> mark all as leaves
  const atMaxDepth = depth >= config.maxStratumDepth;

  // Try structural partition for sets >= 12 with edges
  let structural = null;
  if (atoms.length >= 12 && edges.length > 0) {
    structural = structuralPartition(atoms, edges, { min: 3, max: 7 });
  }

  const atomIds = atoms.map((a) => a.id);
  const inScopeIds = atomIds;

  let compounds: Compound[] | null = null;
  let qualitySource: 'llm' | 'structural' | 'fallback-directory' | 'fallback-flat' = 'llm';

  // Try LLM
  try {
    let attempts = 0;
    const maxAttempts = 1 + config.maxRetries;

    while (attempts < maxAttempts) {
      attempts++;

      const prompt = buildClusterPrompt(
        atoms,
        edges,
        breadcrumbs,
        [],
        structural,
        prevClustering,
        atomDiff,
        depth,
      );

      const response = await llm.complete(prompt, {});

      // Validate LLM response
      const content = response.content as Record<string, unknown> | null;
      if (!content || typeof content !== 'object' || !Array.isArray(content.compounds)) {
        // Invalid response, retry or fallback
        continue;
      }

      const validated = validateStratum(content, inScopeIds, atomIds, depth, config);

      // Progress guard: check if we got more than 1 compound
      if (validated.data.length <= 1) {
        // No progress - retry
        continue;
      }

      compounds = validated.data;
      break;
    }
  } catch {
    // LLM failed, will use fallback
  }

  // If LLM failed or made no progress, use fallback
  if (!compounds) {
    // Delegate to fallbackStratum for the three-tier fallback strategy
    // Build a minimal dirTree from atom paths for directory-based fallback
    const dirTree = buildMinimalDirTree(atoms);
    compounds = fallbackStratum(atoms, edges, structural ?? null, dirTree);

    // Determine quality source based on which tier was used
    if (structural) {
      qualitySource = 'structural';
    } else {
      const dirGroups = new Set(atoms.map((a) => {
        const parts = a.id.split('/');
        return parts.length > 1 ? parts[parts.length - 2] : 'root';
      }));
      qualitySource = dirGroups.size > 1 ? 'fallback-directory' : 'fallback-flat';
    }
  }

  // Set zoomable based on atomIds count and depth
  for (const compound of compounds) {
    compound.zoomable = compound.atomIds.length >= config.minCompoundSize && depth + 1 < config.maxStratumDepth;
    if (atMaxDepth) {
      compound.zoomable = false;
    }
  }

  // Compute relationships from cross-compound edges
  const relationships = computeRelationships(compounds, edges);

  // Compute quality
  const quality = computeQuality(compounds, edges, atoms, qualitySource);

  const stratum: Stratum = {
    depth,
    parentCompoundId: parent ? parent.id : null,
    compounds,
    relationships,
    breadcrumbs: resultBreadcrumbs,
    sourceHash: currentSourceHash,
    quality,
    generatedAt: new Date().toISOString(),
  };

  cache.set(projectId, parentCompoundId, atomType, stratum);
  return stratum;
}

function computeRelationships(compounds: Compound[], edges: ImportEdge[]): StratumRelationship[] {
  // Build atom-to-compound map
  const atomToCompound = new Map<string, string>();
  for (const compound of compounds) {
    for (const atomId of compound.atomIds) {
      atomToCompound.set(atomId, compound.id);
    }
  }

  // Count cross-compound edges
  const edgeCounts = new Map<string, number>();
  for (const edge of edges) {
    const srcCompound = atomToCompound.get(edge.source);
    const tgtCompound = atomToCompound.get(edge.target);

    if (srcCompound && tgtCompound && srcCompound !== tgtCompound) {
      const key = `${srcCompound}::${tgtCompound}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  }

  const relationships: StratumRelationship[] = [];
  for (const [key, count] of edgeCounts) {
    const [sourceId, targetId] = key.split('::');
    relationships.push({
      sourceId,
      targetId,
      kind: 'depends-on',
      edgeCount: count,
    });
  }

  return relationships;
}

/** Build a minimal DirectoryNode tree from atom file paths for fallback use. */
function buildMinimalDirTree(atoms: Atom[]): DirectoryNode {
  const emptyMetrics = {
    fileCount: 0, totalLoc: 0, fileCountByExtension: {},
    exportedSymbolCount: 0, subtreeFileCount: 0, subtreeLoc: 0,
    subtreeExportedSymbolCount: 0, inboundEdges: 0, outboundEdges: 0,
  };

  // Group atoms by immediate parent directory
  const dirFiles = new Map<string, string[]>();
  for (const atom of atoms) {
    const parts = atom.id.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : 'root';
    if (!dirFiles.has(dir)) dirFiles.set(dir, []);
    dirFiles.get(dir)!.push(atom.id);
  }

  const children: DirectoryNode[] = [];
  for (const [dirPath, files] of dirFiles) {
    const name = dirPath.split('/').pop() || dirPath;
    children.push({
      name, path: dirPath, files, children: [],
      isBoundary: false, metrics: { ...emptyMetrics, fileCount: files.length },
    });
  }

  return {
    name: 'root', path: '', files: [],
    children, isBoundary: false, metrics: emptyMetrics,
  };
}
