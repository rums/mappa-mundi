interface ValidatedRegion {
  name: string;
  summary: string;
  modules: string[];
}

interface ValidationResult {
  valid: boolean;
  regions: ValidatedRegion[];
}

export function validateAndFix(raw: unknown, allModuleIds: string[]): ValidationResult {
  if (raw === null || typeof raw !== 'object') {
    return { valid: false, regions: [] };
  }

  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.regions)) {
    return { valid: false, regions: [] };
  }

  const rawRegions = obj.regions as unknown[];

  // Validate each region's structure
  for (const r of rawRegions) {
    if (r === null || typeof r !== 'object') {
      return { valid: false, regions: [] };
    }
    const region = r as Record<string, unknown>;
    if (typeof region.name !== 'string' || region.name.length === 0) {
      return { valid: false, regions: [] };
    }
    if (typeof region.summary !== 'string' || region.summary.length === 0) {
      return { valid: false, regions: [] };
    }
    if (!Array.isArray(region.modules)) {
      return { valid: false, regions: [] };
    }
  }

  // Deep copy regions for mutation
  const regions: ValidatedRegion[] = rawRegions.map((r) => {
    const region = r as { name: string; summary: string; modules: string[] };
    return { name: region.name, summary: region.summary, modules: [...region.modules] };
  });

  // Fix duplicates: keep first assignment
  const seen = new Set<string>();
  for (const region of regions) {
    region.modules = region.modules.filter((m) => {
      if (seen.has(m)) return false;
      seen.add(m);
      return true;
    });
  }

  // Fix orphans: modules in allModuleIds not assigned to any region
  const assigned = new Set<string>();
  for (const region of regions) {
    for (const m of region.modules) {
      assigned.add(m);
    }
  }

  const orphans = allModuleIds.filter((m) => !assigned.has(m));

  if (orphans.length > 0) {
    // Build a list of regions with their module paths for proximity matching
    // If all regions have empty modules, put all orphans in the first region
    const totalAssigned = regions.reduce((sum, r) => sum + r.modules.length, 0);

    if (regions.length === 0) {
      // No regions to assign orphans to — invalid state
      return { valid: false, regions: [] };
    } else if (totalAssigned === 0) {
      // All modules orphaned and regions exist with empty modules - put all in first region
      regions[0].modules.push(...orphans);
    } else {
      // Assign each orphan to the nearest region by directory proximity
      for (const orphan of orphans) {
        let bestRegion = regions[0];
        let bestScore = -1;

        for (const region of regions) {
          if (region.modules.length === 0) continue;

          // Find the longest common directory prefix with any module in this region
          let maxPrefix = 0;
          for (const m of region.modules) {
            const prefix = commonDirPrefix(orphan, m);
            if (prefix > maxPrefix) maxPrefix = prefix;
          }

          if (maxPrefix > bestScore) {
            bestScore = maxPrefix;
            bestRegion = region;
          }
        }

        bestRegion.modules.push(orphan);
      }
    }
  }

  return { valid: true, regions };
}

function commonDirPrefix(a: string, b: string): number {
  const aParts = a.split('/');
  const bParts = b.split('/');
  // Compare directory parts (exclude filename)
  const aDirs = aParts.slice(0, -1);
  const bDirs = bParts.slice(0, -1);

  let common = 0;
  for (let i = 0; i < Math.min(aDirs.length, bDirs.length); i++) {
    if (aDirs[i] === bDirs[i]) {
      common++;
    } else {
      break;
    }
  }
  return common;
}
