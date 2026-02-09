
 Forms schemas

This folder organizes JSON Schemas used by the backend for validating canonical insurance intake payloads.

## Canonical
- Canonical schemas live under `forms/schemas/canonical/`.
- For now, **Clal SMB 15943 (07/2025)** is treated as the canonical structure.

## Products
- Product schemas live under `forms/schemas/products/`.
- In MVP we validate against canonical, and product schemas can either:
  - `$ref` the canonical (when the product is a subset), or
  - extend it with `allOf` (when product-specific fields are added).

## Registry
`forms/schemas/registry.json` maps a `schemaId` (derived from `meta`) to a schema file path.

