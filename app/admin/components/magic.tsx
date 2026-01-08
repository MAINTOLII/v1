

"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  slug: string | null;
  description: string | null;
  tags: string[] | null;
  is_active: boolean | null;
  created_at?: string;
};

type VariantRow = {
  id: string;
  product_id: string;
  name: string;
  variant_type: "weight" | "unit" | string;
  pack_size_g: number | null;
  sell_price: number | null;
  sku: string | null;
  is_active: boolean | null;
  created_at?: string;
};

type InventoryRow = {
  variant_id: string;
  qty_units: number | string | null;
  qty_g: number | string | null;
  updated_at?: string;
};

type VariantImageRow = {
  id: string;
  variant_id: string;
  url: string;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
};

function formatErr(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  const parts: string[] = [];
  if (e?.code) parts.push(`code: ${e.code}`);
  if (e?.details) parts.push(`details: ${e.details}`);
  if (e?.hint) parts.push(`hint: ${e.hint}`);
  if (parts.length) return parts.join(" • ");
  try {
    const keys = Object.getOwnPropertyNames(e);
    const obj: any = {};
    for (const k of keys) obj[k] = (e as any)[k];
    const s = JSON.stringify(obj);
    if (s && s !== "{}") return s;
  } catch {}
  return "Unknown error (check console)";
}

function money(n: any) {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "$0.00";
  return `$${v.toFixed(2)}`;
}

function safeNum(n: any) {
  const v = Number(n ?? 0);
  return isFinite(v) ? v : 0;
}

function isImageFile(f: File) {
  return f.type?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(f.name);
}

// NOTE: Create this bucket in Supabase Storage (public recommended for now)
const BUCKET = "product-images";

export default function Magic() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [variants, setVariants] = useState<VariantRow[]>([]);

  // variant_id -> inventory
  const [inventoryMap, setInventoryMap] = useState<Record<string, InventoryRow>>({});
  // variant_id -> images[]
  const [imagesMap, setImagesMap] = useState<Record<string, VariantImageRow[]>>({});

  // UI selection: per product selected variant
  const [selectedVariantByProduct, setSelectedVariantByProduct] = useState<Record<string, string>>({});
  const [expandedByProduct, setExpandedByProduct] = useState<Record<string, boolean>>({});

  // Stock edit state: variant_id -> draft values
  const [stockDraft, setStockDraft] = useState<Record<string, { qty_units: string; qty_g: string }>>({});
  const [saveStockLoading, setSaveStockLoading] = useState<Record<string, boolean>>({});
  const [uploadLoading, setUploadLoading] = useState<Record<string, boolean>>({});
  const [imageActionLoading, setImageActionLoading] = useState<Record<string, boolean>>({});

  const productsById = useMemo(() => {
    const map: Record<string, ProductRow> = {};
    for (const p of products) map[p.id] = p;
    return map;
  }, [products]);

  const variantsByProduct = useMemo(() => {
    const map: Record<string, VariantRow[]> = {};
    for (const v of variants) {
      if (!map[v.product_id]) map[v.product_id] = [];
      map[v.product_id].push(v);
    }
    // sort variants by cheapest first, then by name
    for (const pid of Object.keys(map)) {
      map[pid].sort((a, b) => {
        const ap = a.sell_price == null ? Number.POSITIVE_INFINITY : Number(a.sell_price);
        const bp = b.sell_price == null ? Number.POSITIVE_INFINITY : Number(b.sell_price);
        if (ap !== bp) return ap - bp;
        return String(a.name).localeCompare(String(b.name));
      });
    }
    return map;
  }, [variants]);

  const filteredProducts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => {
      if (onlyActive && !p.is_active) return false;
      if (!needle) return true;
      const hay = `${p.name ?? ""} ${p.brand ?? ""} ${p.slug ?? ""} ${p.description ?? ""} ${(p.tags ?? []).join(
        " "
      )}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [products, q, onlyActive]);

  function getSelectedVariantId(productId: string) {
    const existing = selectedVariantByProduct[productId];
    if (existing) return existing;
    const vs = variantsByProduct[productId] ?? [];
    // variantsByProduct is already sorted cheapest-first
    return vs[0]?.id ?? null;
  }

  async function loadAll() {
    setLoading(true);
    setErr(null);

    try {
      // 1) Products
      const { data: pData, error: pErr } = await supabase
        .from("products")
        .select("id,name,brand,slug,description,tags,is_active,created_at")
        .order("created_at", { ascending: false })
        .limit(2000);
      if (pErr) throw pErr;
      const p = (pData ?? []) as any as ProductRow[];
      setProducts(p);

      // 2) Variants
      const { data: vData, error: vErr } = await supabase
        .from("product_variants")
        .select("id,product_id,name,variant_type,pack_size_g,sell_price,sku,is_active,created_at")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (vErr) throw vErr;
      const v = (vData ?? []) as any as VariantRow[];
      setVariants(v);

      const variantIds = v.map((x) => x.id);

      // 3) Inventory (optional table)
      if (variantIds.length > 0) {
        const { data: invData, error: invErr } = await supabase
          .from("inventory")
          .select("variant_id,qty_units,qty_g,updated_at")
          .in("variant_id", variantIds)
          .limit(5000);
        if (!invErr) {
          const map: Record<string, InventoryRow> = {};
          for (const r of (invData ?? []) as any[]) {
            map[String(r.variant_id)] = {
              variant_id: String(r.variant_id),
              qty_units: r.qty_units ?? 0,
              qty_g: r.qty_g ?? 0,
              updated_at: r.updated_at,
            };
          }
          setInventoryMap(map);
        }

        // 4) Variant images
        const { data: imgData, error: imgErr } = await supabase
          .from("product_variant_images")
          .select("id,variant_id,url,is_primary,sort_order,created_at")
          .in("variant_id", variantIds)
          .order("is_primary", { ascending: false })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: false })
          .limit(10000);

        if (!imgErr) {
          const map: Record<string, VariantImageRow[]> = {};
          for (const row of (imgData ?? []) as any[]) {
            const vid = String(row.variant_id);
            if (!map[vid]) map[vid] = [];
            map[vid].push({
              id: String(row.id),
              variant_id: vid,
              url: String(row.url),
              is_primary: !!row.is_primary,
              sort_order: Number(row.sort_order ?? 0),
              created_at: String(row.created_at),
            });
          }
          setImagesMap(map);
        }
      }

      // Initialize selection defaults
      setSelectedVariantByProduct((prev) => {
        const next = { ...prev };
        for (const pr of p) {
          if (next[pr.id]) continue;
          const vs = v
            .filter((x) => x.product_id === pr.id)
            .slice()
            .sort((a, b) => {
              const ap = a.sell_price == null ? Number.POSITIVE_INFINITY : Number(a.sell_price);
              const bp = b.sell_price == null ? Number.POSITIVE_INFINITY : Number(b.sell_price);
              if (ap !== bp) return ap - bp;
              return String(a.name).localeCompare(String(b.name));
            });
          if (vs[0]?.id) next[pr.id] = vs[0].id;
        }
        return next;
      });

      // Initialize stock drafts
      setStockDraft((prev) => {
        const next = { ...prev };
        for (const vr of v) {
          if (next[vr.id]) continue;
          const inv = inventoryMap[vr.id];
          const qtyU = inv ? String(inv.qty_units ?? 0) : "0";
          const qtyG = inv ? String(inv.qty_g ?? 0) : "0";
          next[vr.id] = { qty_units: qtyU, qty_g: qtyG };
        }
        return next;
      });
    } catch (e: any) {
      console.error("Magic loadAll error:", e);
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function renderVariantLabel(v: VariantRow) {
    const bits: string[] = [];

    // Never display the literal word "Default" in the UI
    const n = String(v.name ?? "").trim();
    const isDefault = n.toLowerCase() === "default";
    if (!isDefault && n) bits.push(n);

    // Show pack size if relevant
    if (v.variant_type === "weight") {
      if (v.pack_size_g) bits.push(`${v.pack_size_g}g`);
    }

    // If name was Default and there's no other useful label, return empty string
    return bits.join(" • ");
  }

  async function saveStock(variant: VariantRow) {
    const vid = variant.id;
    setSaveStockLoading((m) => ({ ...m, [vid]: true }));
    setErr(null);

    try {
      const draft = stockDraft[vid] ?? { qty_units: "0", qty_g: "0" };
      const qty_units = safeNum(draft.qty_units);
      const qty_g = safeNum(draft.qty_g);

      // Your inventory table may have more columns; this keeps it minimal.
      // It assumes `variant_id` is unique (or PK) for upsert.
      const { error } = await supabase.from("inventory").upsert(
        {
          variant_id: vid,
          qty_units,
          qty_g,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "variant_id" }
      );

      if (error) throw error;

      setInventoryMap((prev) => ({
        ...prev,
        [vid]: { variant_id: vid, qty_units, qty_g, updated_at: new Date().toISOString() },
      }));
    } catch (e: any) {
      console.error("Magic saveStock error:", e);
      setErr(formatErr(e));
    } finally {
      setSaveStockLoading((m) => ({ ...m, [vid]: false }));
    }
  }

  function getPrimaryImageUrlForVariant(variantId: string) {
    const imgs = imagesMap[variantId] ?? [];
    const primary = imgs.find((x) => x.is_primary);
    return primary?.url ?? imgs[0]?.url ?? null;
  }

  function getPrimaryImageUrlForProduct(productId: string, preferredVariantId?: string | null) {
    // 1) Prefer the selected/preferred variant's image
    if (preferredVariantId) {
      const u = getPrimaryImageUrlForVariant(preferredVariantId);
      if (u) return u;
    }

    // 2) Fallback: any other variant image for this product
    const vs = variantsByProduct[productId] ?? [];
    for (const v of vs) {
      if (preferredVariantId && v.id === preferredVariantId) continue;
      const u = getPrimaryImageUrlForVariant(v.id);
      if (u) return u;
    }

    return null;
  }

  async function uploadVariantImage(variantId: string, file: File) {
    setUploadLoading((m) => ({ ...m, [variantId]: true }));
    setErr(null);

    try {
      if (!isImageFile(file)) {
        throw new Error("Please choose an image file (png/jpg/webp/etc). ");
      }

      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `variants/${variantId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined,
      });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const url = pub?.publicUrl;
      if (!url) throw new Error("Upload succeeded but URL is missing");

      // Insert image row
      const existing = imagesMap[variantId] ?? [];
      const makePrimary = existing.length === 0; // first image auto-primary

      const { data: inserted, error: insErr } = await supabase
        .from("product_variant_images")
        .insert({ variant_id: variantId, url, is_primary: makePrimary, sort_order: existing.length } as any)
        .select("id,variant_id,url,is_primary,sort_order,created_at")
        .single();

      if (insErr) throw insErr;

      setImagesMap((prev) => {
        const next = { ...prev };
        const arr = [...(next[variantId] ?? [])];
        arr.unshift({
          id: String((inserted as any).id),
          variant_id: String((inserted as any).variant_id),
          url: String((inserted as any).url),
          is_primary: !!(inserted as any).is_primary,
          sort_order: Number((inserted as any).sort_order ?? 0),
          created_at: String((inserted as any).created_at),
        });
        // keep primary first
        arr.sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
        next[variantId] = arr;
        return next;
      });
    } catch (e: any) {
      console.error("Magic uploadVariantImage error:", e);
      setErr(formatErr(e));
    } finally {
      setUploadLoading((m) => ({ ...m, [variantId]: false }));
    }
  }

  async function setPrimaryImage(variantId: string, imageId: string) {
    const key = `${variantId}:${imageId}:primary`;
    setImageActionLoading((m) => ({ ...m, [key]: true }));
    setErr(null);

    try {
      // Make all false then set one true (simple & safe)
      const { error: clearErr } = await supabase
        .from("product_variant_images")
        .update({ is_primary: false })
        .eq("variant_id", variantId);
      if (clearErr) throw clearErr;

      const { error: setErr2 } = await supabase
        .from("product_variant_images")
        .update({ is_primary: true })
        .eq("id", imageId)
        .eq("variant_id", variantId);
      if (setErr2) throw setErr2;

      setImagesMap((prev) => {
        const next = { ...prev };
        const arr = (next[variantId] ?? []).map((img) => ({ ...img, is_primary: img.id === imageId }));
        arr.sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
        next[variantId] = arr;
        return next;
      });
    } catch (e: any) {
      console.error("Magic setPrimaryImage error:", e);
      setErr(formatErr(e));
    } finally {
      setImageActionLoading((m) => ({ ...m, [key]: false }));
    }
  }

  async function deleteImage(variantId: string, image: VariantImageRow) {
    const key = `${variantId}:${image.id}:delete`;
    setImageActionLoading((m) => ({ ...m, [key]: true }));
    setErr(null);

    try {
      const { error: delErr } = await supabase.from("product_variant_images").delete().eq("id", image.id);
      if (delErr) throw delErr;

      setImagesMap((prev) => {
        const next = { ...prev };
        const arr = (next[variantId] ?? []).filter((x) => x.id !== image.id);
        next[variantId] = arr;
        return next;
      });
    } catch (e: any) {
      console.error("Magic deleteImage error:", e);
      setErr(formatErr(e));
    } finally {
      setImageActionLoading((m) => ({ ...m, [key]: false }));
    }
  }

  return (
    <div className="w-full">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Magic</h2>
          <p className="mt-1 text-sm text-gray-600">Products as cards, variants as buttons, and variant images + stock.</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search products…"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
              Active only
            </label>
          </div>
          <button
            type="button"
            onClick={loadAll}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {err && <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{err}</div>}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {filteredProducts.map((p) => {
          const vs = variantsByProduct[p.id] ?? [];
          const selectedVariantId = getSelectedVariantId(p.id);
          const selectedVariant = selectedVariantId ? vs.find((x) => x.id === selectedVariantId) ?? null : null;
          const inv = selectedVariantId ? inventoryMap[selectedVariantId] : null;
          const imgs = selectedVariantId ? imagesMap[selectedVariantId] ?? [] : [];
          const primaryUrl = getPrimaryImageUrlForProduct(p.id, selectedVariantId);
          const draft = selectedVariantId ? stockDraft[selectedVariantId] ?? { qty_units: "0", qty_g: "0" } : null;
          const isExpanded = !!expandedByProduct[p.id];
          const price = selectedVariant?.sell_price != null ? money(selectedVariant.sell_price) : "—";

          return (
            <div key={p.id} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="relative aspect-square bg-gray-50">
                {primaryUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={primaryUrl} alt={p.name} className="h-full w-full object-cover" />
                ) : null}
                {p.is_active === false ? (
                  <div className="absolute left-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                    Inactive
                  </div>
                ) : null}
              </div>

              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-gray-900">{p.name}</div>
                    {p.brand ? <div className="truncate text-[11px] text-gray-600">{p.brand}</div> : <div className="text-[11px] text-gray-500">&nbsp;</div>}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setExpandedByProduct((prev) => ({
                        ...prev,
                        [p.id]: !prev[p.id],
                      }))
                    }
                    className="shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1 text-[11px] text-gray-800 hover:bg-gray-50"
                  >
                    {isExpanded ? "Close" : "Manage"}
                  </button>
                </div>

                <div className="mt-2">
                  <div className="text-[11px] text-gray-600">Selected</div>
                  <div className="truncate text-xs font-semibold text-gray-900">
                    {selectedVariant ? (() => {
                      const label = renderVariantLabel(selectedVariant);
                      // If the only variant is the auto-created Default, don't show any label here.
                      if ((vs?.length ?? 0) <= 1 && !label) return "";
                      return label || "";
                    })() : "No variant"}
                  </div>
                  <div className="mt-1 text-lg font-bold text-gray-900">{price}</div>
                </div>

                <div className="mt-3">
                  {vs.length === 0 ? (
                    <div className="rounded-xl border bg-gray-50 p-2 text-xs text-gray-700">No variants.</div>
                  ) : vs.length === 1 ? (
                    // Single-variant product (often the auto-created "Default" variant) -> don't show selector buttons
                    <div className="text-[11px] text-gray-500">&nbsp;</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {vs.map((v) => {
                        const active = v.id === selectedVariantId;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() =>
                              setSelectedVariantByProduct((prev) => ({
                                ...prev,
                                [p.id]: v.id,
                              }))
                            }
                            className={
                              "rounded-full border px-3 py-1 text-[11px] " +
                              (active
                                ? "border-green-600 bg-green-50 text-green-800"
                                : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50")
                            }
                            title={renderVariantLabel(v)}
                          >
                            {(() => {
                              const label = renderVariantLabel(v);
                              // Fallback if label is empty (e.g., a Default variant)
                              return label || (v.pack_size_g ? `${v.pack_size_g}g` : (v.variant_type || "Variant"));
                            })()}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {isExpanded && selectedVariant ? (
                  <div className="mt-3 rounded-xl border bg-gray-50 p-3">
                    <div className="text-xs font-semibold text-gray-800">Inventory & Images</div>
                    <div className="mt-1 text-[11px] text-gray-600">
                      SKU: {selectedVariant.sku ?? "—"} • Type: {selectedVariant.variant_type}
                      {selectedVariant.pack_size_g ? ` • Pack: ${selectedVariant.pack_size_g}g` : ""}
                    </div>

                    {/* Stock summary */}
                    <div className="mt-2 rounded-lg border bg-white px-3 py-2 text-xs text-gray-700">
                      <div className="font-semibold">Current stock</div>
                      <div className="mt-1">
                        Units: <b>{inv ? safeNum(inv.qty_units) : 0}</b> • Weight(g): <b>{inv ? safeNum(inv.qty_g) : 0}</b>
                      </div>
                    </div>

                    {/* Stock editor */}
                    <div className="mt-2 grid gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] text-gray-700">qty_units</label>
                          <input
                            value={draft?.qty_units ?? "0"}
                            onChange={(e) =>
                              setStockDraft((prev) => ({
                                ...prev,
                                [selectedVariant.id]: {
                                  qty_units: e.target.value,
                                  qty_g: prev[selectedVariant.id]?.qty_g ?? "0",
                                },
                              }))
                            }
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-700">qty_g</label>
                          <input
                            value={draft?.qty_g ?? "0"}
                            onChange={(e) =>
                              setStockDraft((prev) => ({
                                ...prev,
                                [selectedVariant.id]: {
                                  qty_units: prev[selectedVariant.id]?.qty_units ?? "0",
                                  qty_g: e.target.value,
                                },
                              }))
                            }
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => saveStock(selectedVariant)}
                        className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                        disabled={!!saveStockLoading[selectedVariant.id]}
                      >
                        {saveStockLoading[selectedVariant.id] ? "Saving…" : "Save stock"}
                      </button>
                    </div>

                    {/* Images */}
                    <div className="mt-3 rounded-xl border bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold">Variant images</div>
                          <div className="mt-1 text-[11px] text-gray-600">Upload images per variant. Set one as primary.</div>
                        </div>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[11px] hover:bg-gray-50">
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              uploadVariantImage(selectedVariant.id, f);
                              e.currentTarget.value = "";
                            }}
                            disabled={!!uploadLoading[selectedVariant.id]}
                          />
                          {uploadLoading[selectedVariant.id] ? "Uploading…" : "Upload"}
                        </label>
                      </div>

                      {imgs.length === 0 ? (
                        <div className="mt-3 rounded-lg border bg-gray-50 p-3 text-xs text-gray-700">No images yet.</div>
                      ) : (
                        <div className="mt-3 grid gap-3">
                          {imgs.slice(0, 6).map((img) => {
                            const primary = img.is_primary;
                            const pKey = `${selectedVariant.id}:${img.id}:primary`;
                            const dKey = `${selectedVariant.id}:${img.id}:delete`;
                            return (
                              <div key={img.id} className="overflow-hidden rounded-xl border">
                                <div className="aspect-[4/3] bg-gray-50">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={img.url} alt="Variant" className="h-full w-full object-cover" />
                                </div>
                                <div className="flex items-center justify-between gap-2 p-2">
                                  <div className="text-[11px] text-gray-700">
                                    {primary ? (
                                      <span className="rounded bg-green-50 px-2 py-0.5 text-green-800">Primary</span>
                                    ) : (
                                      <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-700">Image</span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {!primary && (
                                      <button
                                        type="button"
                                        onClick={() => setPrimaryImage(selectedVariant.id, img.id)}
                                        className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-[11px] hover:bg-gray-50 disabled:opacity-60"
                                        disabled={!!imageActionLoading[pKey]}
                                      >
                                        {imageActionLoading[pKey] ? "…" : "Set primary"}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => deleteImage(selectedVariant.id, img)}
                                      className="rounded-lg border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50 disabled:opacity-60"
                                      disabled={!!imageActionLoading[dKey]}
                                    >
                                      {imageActionLoading[dKey] ? "…" : "Delete"}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {(p.description || (p.tags && p.tags.length > 0)) ? (
                      <div className="mt-3 rounded-xl border bg-white p-3">
                        {p.description ? <div className="text-xs text-gray-700">{p.description}</div> : null}
                        {p.tags && p.tags.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {p.tags.slice(0, 12).map((t, i) => (
                              <span key={i} className="rounded-full border bg-gray-50 px-2 py-0.5 text-[11px] text-gray-700">
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {filteredProducts.length === 0 && !loading ? (
        <div className="mt-6 rounded-xl border bg-gray-50 p-4 text-sm text-gray-700">No products found.</div>
      ) : null}

      <div className="mt-6 text-xs text-gray-500">
        This page reads: <code>products</code>, <code>product_variants</code>, <code>inventory</code>, and <code>product_variant_images</code>.
      </div>
    </div>
  );
}