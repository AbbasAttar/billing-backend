/**
 * Brand names for a shared lens entry: the same thing sold under each company's own name
 * (coating Hard Coat = Crizal "Rock" = Dioptres "Tuff"). One name per company.
 */
export interface BrandAlias {
  company: string;
  name: string;
}

const clean = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

export class AliasError extends Error {}

/** undefined = not sent. Drops blank rows; the last name given for a company wins. */
export function readAliases(v: unknown): BrandAlias[] | undefined {
  if (v === undefined) return undefined;
  if (v === null) return [];
  if (!Array.isArray(v)) throw new AliasError('brand names must be a list');
  const byCompany = new Map<string, BrandAlias>();
  for (const raw of v) {
    const company = clean((raw as any)?.company);
    const name = clean((raw as any)?.name);
    if (!company && !name) continue;
    if (!company || company.length > 60) throw new AliasError('each brand name needs its company');
    if (!name || name.length > 40) throw new AliasError(`brand name for ${company} is required (max 40 characters)`);
    byCompany.set(company.toLowerCase(), { company, name });
  }
  return [...byCompany.values()].sort((a, b) => a.company.localeCompare(b.company));
}

/** The name a company sells this entry under, else the shared name. */
export function brandName(entry: { name: string; aliases?: BrandAlias[] | null }, company?: string | null): string {
  if (!company) return entry.name;
  const hit = entry.aliases?.find((a) => a.company.toLowerCase() === company.trim().toLowerCase());
  return hit?.name ?? entry.name;
}
