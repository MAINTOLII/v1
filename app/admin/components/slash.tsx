"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// Quick Add Product (FAST):
// - Select an existing subsubcategory (subsubcategories) via quick search
// - Create product
// - Create ONE default variant automatically (Option A)
// - Optionally switch to multi-variant mode
// - Set inventory totals + avg cost directly (NO inventory_movements)

// ---------- Supabase client ----------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Check your .env."
  );
}

const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");

// ---------- Types ----------

type SubsubPick = {
  id: string;
  slug: string;
  name_en: string;
  name_so: string;
};

type VariantDraft = {
  name: string;
  variant_type: string; // stored as text
  pack_size_g?: number | "";
  sell_price?: number | "";
  is_active?: boolean;

  // Inventory totals (set/overwrite)
  qty_g?: number | "";
  qty_units?: number | "";

  // Inventory cost (avg)
  avg_cost_per_g?: number | "";
  avg_cost_per_unit?: number | "";

  // Optional image URL
  primary_image_url?: string;
};

type CreateResult = {
  subsubcat_id?: string;
  product_id?: string;
  variant_ids?: string[];
};

// ---------- Helpers ----------

function slugify(input: string): string {
  return (input || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function toNumberOrNull(v: unknown): number | null {
  if (v === "" || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBigIntOrNull(v: unknown): number | null {
  const n = toNumberOrNull(v);
  if (n === null) return null;
  return Math.trunc(n);
}

function normalizeVariant(v: VariantDraft): VariantDraft {
  // Option A: always create at least one variant.
  // If user leaves name empty, we store "Default".
  const name = (v.name || "").trim() || "Default";
  const variant_type = (v.variant_type || "").trim() || "unit";

  return {
    ...v,
    name,
    variant_type,
  };
}

async function createProduct(args: {
  subsubcat_id: string;
  name: string;
  brand?: string | null;
  is_active?: boolean;
  slug?: string | null;
  description?: string | null;
  tags?: string[];
}): Promise<{ id: string }> {
  const payload = {
    subsubcat_id: args.subsubcat_id,
    name: args.name,
    brand: args.brand ?? null,
    is_active: args.is_active ?? true,
    slug: args.slug ?? slugify(args.name),
    description: args.description ?? null,
    tags: args.tags ?? [], // NOT NULL in your snapshot
  };

  const { data: inserted, error } = await supabase
    .from("products")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw error;
  return { id: inserted.id };
}

async function createVariant(args: {
  product_id: string;
  v: VariantDraft;
}): Promise<{ id: string }> {
  const v = normalizeVariant(args.v);

  const { data: inserted, error } = await supabase
    .from("product_variants")
    .insert({
      product_id: args.product_id,
      name: v.name,
      variant_type: v.variant_type,
      pack_size_g: toNumberOrNull(v.pack_size_g),
      sell_price: toNumberOrNull(v.sell_price),
      is_active: v.is_active ?? true,
      // SKU intentionally unused in UI; keep null
      sku: null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { id: inserted.id };
}

async function upsertInventory(args: {
  variant_id: string;
  qty_g?: number | null;
  qty_units?: number | null;
  avg_cost_per_g?: number | null;
  avg_cost_per_unit?: number | null;
}): Promise<void> {
  const { error } = await supabase.from("inventory").upsert(
    {
      variant_id: args.variant_id,
      qty_g: args.qty_g ?? null,
      qty_units: args.qty_units ?? null,
      avg_cost_per_g: args.avg_cost_per_g ?? null,
      avg_cost_per_unit: args.avg_cost_per_unit ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "variant_id" }
  );
  if (error) throw error;
}

async function insertPrimaryImage(args: {
  variant_id: string;
  url: string;
}): Promise<void> {
  const url = (args.url || "").trim();
  if (!url) return;

  const { error } = await supabase.from("product_variant_images").insert({
    variant_id: args.variant_id,
    url,
    is_primary: true,
    sort_order: 1,
  });

  if (error) throw error;
}

// ---------- UI Component ----------
const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    style={{
      width: "100%",
      padding: 10,
      borderRadius: 8,
      border: "1px solid #ddd",
      ...(props.style ?? {}),
    }}
  />
);

const Label = ({ children }: { children: React.ReactNode }) => (
  <label style={{ display: "block", fontSize: 12, opacity: 0.8 }}>{children}</label>
);
export default function Slash() {
  // Subsubcategory picker
  const [subsubQuery, setSubsubQuery] = useState("");
  const [subsubLoading, setSubsubLoading] = useState(false);
  const [subsubResults, setSubsubResults] = useState<SubsubPick[]>([]);
  const [pickedSubsub, setPickedSubsub] = useState<SubsubPick | null>(null);
  const [subsubOpen, setSubsubOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Product
  const [prodName, setProdName] = useState("");
  const [brand, setBrand] = useState("");
  const [description, setDescription] = useState("");
  const [tagsCsv, setTagsCsv] = useState("");
  const [productActive, setProductActive] = useState(true);

  // Option A mode toggle
  const [multiVariants, setMultiVariants] = useState(false);

  // Single (default) variant
  const [singleVariant, setSingleVariant] = useState<VariantDraft>({
    name: "",
    variant_type: "unit",
    pack_size_g: "",
    sell_price: "",
    is_active: true,
    qty_g: "",
    qty_units: "",
    avg_cost_per_g: "",
    avg_cost_per_unit: "",
    primary_image_url: "",
  });

  // Multi variants
  const [variants, setVariants] = useState<VariantDraft[]>([
    {
      name: "",
      variant_type: "unit",
      pack_size_g: "",
      sell_price: "",
      is_active: true,
      qty_g: "",
      qty_units: "",
      avg_cost_per_g: "",
      avg_cost_per_unit: "",
      primary_image_url: "",
    },
  ]);

  // Status
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<CreateResult | null>(null);

  const tagsArray = useMemo(() => {
    const raw = (tagsCsv || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    return Array.from(new Set(raw));
  }, [tagsCsv]);

  const updateVariant = useCallback((idx: number, patch: Partial<VariantDraft>) => {
    setVariants((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...patch };
      return copy;
    });
  }, []);

  const addVariant = useCallback(() => {
    setVariants((prev) => [
      ...prev,
      {
        name: "",
        variant_type: "unit",
        pack_size_g: "",
        sell_price: "",
        is_active: true,
        qty_g: "",
        qty_units: "",
        avg_cost_per_g: "",
        avg_cost_per_unit: "",
        primary_image_url: "",
      },
    ]);
  }, []);

  const removeVariant = useCallback((idx: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const validate = useCallback(() => {
    if (!pickedSubsub?.id) return "Select a Subsubcategory first.";
    if (!prodName.trim()) return "Product name is required.";

    if (!multiVariants) {
      const vt = (singleVariant.variant_type || "").trim();
      if (!vt) return "Variant type is required (or leave it and it becomes 'unit').";
      return null;
    }

    if (!variants.length) return "Add at least 1 variant.";
    for (const [i, v] of variants.entries()) {
      if (!(v.name || "").trim()) return `Variant #${i + 1}: name is required.`;
      if (!(v.variant_type || "").trim())
        return `Variant #${i + 1}: variant_type is required.`;
    }

    return null;
  }, [pickedSubsub, prodName, multiVariants, singleVariant, variants]);

  const resetAlerts = useCallback(() => {
    setSuccessMsg(null);
    setErrorMsg(null);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const el = dropdownRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setSubsubOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Debounced search for subsubcategories
  useEffect(() => {
    const q = subsubQuery.trim();
    if (!q) {
      setSubsubResults([]);
      return;
    }

    const t = window.setTimeout(async () => {
      setSubsubLoading(true);
      try {
        const or = `name_en.ilike.%${q}%,name_so.ilike.%${q}%,slug.ilike.%${q}%`;
        const { data, error } = await supabase
          .from("subsubcategories")
          .select("id,slug,name_en,name_so")
          .or(or)
          .order("name_en", { ascending: true })
          .limit(30);

        if (error) throw error;
        setSubsubResults((data ?? []) as SubsubPick[]);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error(e);
        setSubsubResults([]);
      } finally {
        setSubsubLoading(false);
      }
    }, 150);

    return () => window.clearTimeout(t);
  }, [subsubQuery]);

  const handlePick = useCallback((s: SubsubPick) => {
    setPickedSubsub(s);
    setSubsubQuery(`${s.name_en} / ${s.name_so}`);
    setSubsubOpen(false);
  }, []);

  const upsertInventoryFromVariantDraft = useCallback(
    async (variantId: string, v: VariantDraft) => {
      const qty_g = toBigIntOrNull(v.qty_g);
      const qty_units = toBigIntOrNull(v.qty_units);
      const avg_cost_per_g = toNumberOrNull(v.avg_cost_per_g);
      const avg_cost_per_unit = toNumberOrNull(v.avg_cost_per_unit);

      await upsertInventory({
        variant_id: variantId,
        qty_g,
        qty_units,
        avg_cost_per_g,
        avg_cost_per_unit,
      });
    },
    []
  );

  const handleCreate = useCallback(async () => {
    resetAlerts();
    const vErr = validate();
    if (vErr) {
      setErrorMsg(vErr);
      return;
    }

    setBusy(true);
    try {
      const product = await createProduct({
        subsubcat_id: pickedSubsub!.id,
        name: prodName.trim(),
        brand: brand.trim() || null,
        is_active: productActive,
        slug: slugify(prodName),
        description: description.trim() || null,
        tags: tagsArray,
      });

      const createdVariantIds: string[] = [];

      const drafts: VariantDraft[] = multiVariants ? variants : [singleVariant];

      for (const raw of drafts) {
        const v = normalizeVariant(raw);

        const variant = await createVariant({
          product_id: product.id,
          v,
        });
        createdVariantIds.push(variant.id);

        await upsertInventoryFromVariantDraft(variant.id, v);

        if (v.primary_image_url && v.primary_image_url.trim()) {
          await insertPrimaryImage({
            variant_id: variant.id,
            url: v.primary_image_url,
          });
        }
      }

      const result: CreateResult = {
        subsubcat_id: pickedSubsub!.id,
        product_id: product.id,
        variant_ids: createdVariantIds,
      };

      setLastResult(result);
      setSuccessMsg("✅ Created product + variant(s) + inventory.");

      // Reset product fields for fast entry
      setProdName("");
      setBrand("");
      setDescription("");
      setTagsCsv("");

      // Reset variants
      setSingleVariant({
        name: "",
        variant_type: "unit",
        pack_size_g: "",
        sell_price: "",
        is_active: true,
        qty_g: "",
        qty_units: "",
        avg_cost_per_g: "",
        avg_cost_per_unit: "",
        primary_image_url: "",
      });
      setVariants([
        {
          name: "",
          variant_type: "unit",
          pack_size_g: "",
          sell_price: "",
          is_active: true,
          qty_g: "",
          qty_units: "",
          avg_cost_per_g: "",
          avg_cost_per_unit: "",
          primary_image_url: "",
        },
      ]);
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : "Unknown error";
      setErrorMsg(`❌ ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [
    resetAlerts,
    validate,
    pickedSubsub,
    prodName,
    brand,
    productActive,
    description,
    tagsArray,
    multiVariants,
    variants,
    singleVariant,
    upsertInventoryFromVariantDraft,
  ]);

  // ---------- Small UI helpers ----------



function renderVariantCard(
  v: VariantDraft,
  onChange: (patch: Partial<VariantDraft>) => void,
  title?: string,
  onRemove?: (() => void) | null,
  showName: boolean = true
) {
    return (
      <div style={{ border: "1px solid #f0f0f0", borderRadius: 10, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>{title ?? "Variant"}</strong>
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "white",
                cursor: "pointer",
              }}
            >
              Remove
            </button>
          ) : null}
        </div>

<div
  style={{
    display: "grid",
    gridTemplateColumns: showName ? "2fr 1fr 1fr 1fr" : "1fr 1fr 1fr",
    gap: 10,
    marginTop: 10,
  }}
>
  {showName ? (
    <div>
      <Label>Variant name</Label>
      <Input
        value={v.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="330ml / 1L"
      />
    </div>
  ) : null}

  <div>
    <Label>Type</Label>
    <Input
      value={v.variant_type}
      onChange={(e) => onChange({ variant_type: e.target.value })}
      placeholder="unit / g / pack"
    />
  </div>

  <div>
    <Label>Pack g (opt)</Label>
    <Input
      type="number"
      value={v.pack_size_g ?? ""}
      onChange={(e) =>
        onChange({ pack_size_g: e.target.value === "" ? "" : Number(e.target.value) })
      }
    />
  </div>

  <div>
    <Label>Sell price</Label>
    <Input
      type="number"
      step="0.01"
      value={v.sell_price ?? ""}
      onChange={(e) =>
        onChange({ sell_price: e.target.value === "" ? "" : Number(e.target.value) })
      }
    />
  </div>
</div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 10,
            marginTop: 10,
          }}
        >
          <div>
            <Label>Total qty (g)</Label>
            <Input
              type="number"
              value={v.qty_g ?? ""}
              onChange={(e) =>
                onChange({ qty_g: e.target.value === "" ? "" : Number(e.target.value) })
              }
            />
          </div>
          <div>
            <Label>Total qty (units)</Label>
            <Input
              type="number"
              value={v.qty_units ?? ""}
              onChange={(e) =>
                onChange({ qty_units: e.target.value === "" ? "" : Number(e.target.value) })
              }
            />
          </div>
          <div>
            <Label>Avg cost / g</Label>
            <Input
              type="number"
              step="0.0001"
              value={v.avg_cost_per_g ?? ""}
              onChange={(e) =>
                onChange({
                  avg_cost_per_g: e.target.value === "" ? "" : Number(e.target.value),
                })
              }
            />
          </div>
          <div>
            <Label>Avg cost / unit</Label>
            <Input
              type="number"
              step="0.01"
              value={v.avg_cost_per_unit ?? ""}
              onChange={(e) =>
                onChange({
                  avg_cost_per_unit: e.target.value === "" ? "" : Number(e.target.value),
                })
              }
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginTop: 10 }}>
          <div>
            <Label>Primary image URL (optional)</Label>
            <Input
              value={v.primary_image_url ?? ""}
              onChange={(e) => onChange({ primary_image_url: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <div>
            <Label>Active</Label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
              <input
                type="checkbox"
                checked={v.is_active ?? true}
                onChange={(e) => onChange({ is_active: e.target.checked })}
              />
              <span style={{ fontSize: 14 }}>{(v.is_active ?? true) ? "Yes" : "No"}</span>
            </label>
          </div>
        </div>

        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
          Inventory is set directly on <code>inventory</code> (no stock movement logging).
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 1050 }}>
<h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Quick Add Product</h2>
<p style={{ marginTop: 0, opacity: 0.8 }}>
  Single items are fast: we automatically create one internal variant for each product.
  Turn on Multi-variants only when you actually need sizes/flavors.
</p>
      {errorMsg ? (
        <div style={{ background: "#ffe6e6", padding: 12, borderRadius: 8, marginBottom: 12 }}>
          {errorMsg}
        </div>
      ) : null}
      {successMsg ? (
        <div style={{ background: "#eaffea", padding: 12, borderRadius: 8, marginBottom: 12 }}>
          {successMsg}
        </div>
      ) : null}

      {/* Subsubcategory Search */}
      <section
        style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, marginBottom: 12 }}
      >
        <h3 style={{ marginTop: 0 }}>1) Choose Subsubcategory</h3>

        <div ref={dropdownRef} style={{ position: "relative" }}>
          <Label>Search subsubcategory (EN / SO / slug)</Label>
          <Input
            value={subsubQuery}
            onChange={(e) => {
              setSubsubQuery(e.target.value);
              setSubsubOpen(true);
              setPickedSubsub(null);
            }}
            onFocus={() => setSubsubOpen(true)}
            placeholder="Type to search..."
          />

          {subsubOpen && (subsubLoading || subsubResults.length > 0) ? (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                right: 0,
                background: "white",
                border: "1px solid #ddd",
                borderRadius: 10,
                overflow: "hidden",
                zIndex: 50,
                maxHeight: 280,
                overflowY: "auto",
              }}
            >
              {subsubLoading ? (
                <div style={{ padding: 10, fontSize: 14, opacity: 0.7 }}>Searching…</div>
              ) : null}

              {!subsubLoading && subsubResults.length === 0 ? (
                <div style={{ padding: 10, fontSize: 14, opacity: 0.7 }}>No matches.</div>
              ) : null}

              {!subsubLoading && subsubResults.length > 0 ? (
                <div>
                  {subsubResults.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handlePick(s)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: 10,
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        borderBottom: "1px solid #f0f0f0",
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name_en}</div>
                      <div style={{ fontSize: 13, opacity: 0.8 }}>
                        {s.name_so} • {s.slug}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {pickedSubsub ? (
          <div style={{ marginTop: 10, fontSize: 14 }}>
            Selected: <strong>{pickedSubsub.name_en}</strong> ({pickedSubsub.name_so})
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
            Tip: type fast and click the match.
          </div>
        )}
      </section>

      {/* Product */}
      <section
        style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, marginBottom: 12 }}
      >
        <h3 style={{ marginTop: 0 }}>2) Product</h3>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
          <div>
            <Label>Product name</Label>
            <Input value={prodName} onChange={(e) => setProdName(e.target.value)} />
          </div>
          <div>
            <Label>Brand (optional)</Label>
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div>
            <Label>Active</Label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
              <input
                type="checkbox"
                checked={productActive}
                onChange={(e) => setProductActive(e.target.checked)}
              />
              <span style={{ fontSize: 14 }}>{productActive ? "Yes" : "No"}</span>
            </label>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginTop: 12 }}>
          <div>
            <Label>Tags (comma separated)</Label>
            <Input
              value={tagsCsv}
              onChange={(e) => setTagsCsv(e.target.value)}
              placeholder="softdrink,cola"
            />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      </section>

      {/* Variants */}
      <section style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ margin: 0 }}>3) Variant(s) + Inventory</h3>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={multiVariants}
              onChange={(e) => setMultiVariants(e.target.checked)}
            />
            <span style={{ fontSize: 14, fontWeight: 700 }}>Multi-variants</span>
          </label>
        </div>

        {!multiVariants ? (
          <div style={{ marginTop: 10 }}>
{renderVariantCard(
  singleVariant,
  (patch) => setSingleVariant((p) => ({ ...p, ...patch })),
  "Inventory",
  null,
  false
)}
          </div>
        ) : (
          <>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={addVariant}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: "white",
                  cursor: "pointer",
                }}
              >
                + Add variant
              </button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {variants.map((v, idx) => (
                <div key={idx}>
                  {renderVariantCard(
                    v,
                    (patch) => updateVariant(idx, patch),
                    `Variant #${idx + 1}`,
                    variants.length > 1 ? () => removeVariant(idx) : null
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14 }}>
        <button
          type="button"
          onClick={handleCreate}
          disabled={busy}
          style={{
            padding: "10px 14px",
            fontWeight: 700,
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            cursor: "pointer",
          }}
        >
          {busy ? "Creating…" : "Create Product"}
        </button>

        {lastResult?.product_id ? (
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            Last created: product_id <code>{lastResult.product_id}</code>
          </div>
        ) : null}
      </div>

      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 14 }}>
        <strong>Important:</strong> This uses the public Supabase client. Ensure your Supabase RLS
        policies allow inserts for your admin session.
      </div>
    </div>
  );
}