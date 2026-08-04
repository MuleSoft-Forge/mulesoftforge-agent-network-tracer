export interface OrgEnvironment {
  id: string;
  name: string;
}

export async function fetchOrgEnvironments(
  baseUrl: string,
  orgId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch
): Promise<OrgEnvironment[]> {
  const url = `${baseUrl}/accounts/api/organizations/${encodeURIComponent(orgId)}/environments`;
  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];

  const data = (await res.json()) as {
    data?: Array<{ id?: string; name?: string }>;
  };
  return (data.data ?? [])
    .filter((e): e is { id: string; name?: string } => typeof e.id === "string")
    .map((e) => ({ id: e.id, name: e.name ?? e.id }));
}
