/** Normalize AMC / GAV app names for fuzzy comparison (underscore vs hyphen). */
export function normalizeDeploymentName(name: string): string {
  return name.toLowerCase().replace(/_/g, "-").replace(/-and-/gi, "-");
}

export function deploymentNamesMatch(a: string, b: string): boolean {
  const na = normalizeDeploymentName(a);
  const nb = normalizeDeploymentName(b);
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

export interface AmcDeploymentItem {
  id: string;
  name: string;
}

/** Unique candidate names to try when resolving an AMC deployment (exact + hyphen variant). */
export function deploymentNameCandidates(...names: Array<string | undefined>): string[] {
  const out = new Set<string>();
  for (const name of names) {
    if (!name) continue;
    out.add(name);
    const hyphenated = name.replace(/_/g, "-");
    if (hyphenated !== name) out.add(hyphenated);
  }
  return [...out];
}

export function findAmcDeploymentByNames(
  items: AmcDeploymentItem[],
  candidateNames: string[]
): AmcDeploymentItem | undefined {
  for (const candidate of candidateNames) {
    const exact = items.find((d) => d.name === candidate);
    if (exact) return exact;
  }
  for (const candidate of candidateNames) {
    const fuzzy = items.find((d) => deploymentNamesMatch(d.name, candidate));
    if (fuzzy) return fuzzy;
  }
  return undefined;
}
