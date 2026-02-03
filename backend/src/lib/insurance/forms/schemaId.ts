export type IntakeMeta = {
  insurer?: string;
  form_catalog_number?: string;
  form_version_date?: string;
};

export function deriveSchemaIdFromPayload(payload: any): string | null {
  const meta: IntakeMeta | undefined = payload?.meta;
  if (!meta?.insurer || !meta.form_catalog_number || !meta.form_version_date) return null;
  return `${meta.insurer}/${meta.form_catalog_number}/${meta.form_version_date}`;
}
