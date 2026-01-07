"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Category = { id: string; name_en?: string | null; name_so?: string | null; slug?: string | null };
type Subcategory = {
  id: string;
  name_en?: string | null;
  name_so?: string | null;
  slug?: string | null;
  category?: Category | null;
};
type SubsubCategory = {
  id: string;
  name_en?: string | null;
  name_so?: string | null;
  slug?: string | null;
  subcategory?: Subcategory | null;
};

type Product = {
  id: string;
  name: string;
  brand: string | null;
  is_active: boolean;
  subsub?: SubsubCategory | null;
};

type Variant = {
  id: string;
  product_id: string;
  name: string;
  variant_type: string; // unit | weight
  pack_size_g: number | null;
  sell_price: number;
  sku: string | null;
  is_active: boolean;
  created_at?: string;
  product?: Product | null;
};

function asOne<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function displayName(row: any): string {
  const en = row?.name_en;
  const so = row?.name_so;
  const slug = row?.slug;
  const id = row?.id;
  return String(en ?? so ?? slug ?? id ?? "");
}

function kgToG(inputKg: string) {
  const n = Number(inputKg);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000);
}

function gToKgString(g?: number | null) {
  const n = Number(g ?? 0);
  if (!Number.isFinite(n) || n === 0) return "";
  return (n / 1000).toFixed(3);
}

function formatMoney(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toString();
}

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
  } catch {
    // ignore
  }
  return "Unknown error (check console)";
}

export default function VariantsManagerSection() {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [variants, setVariants] = useState<Variant[]>([]);

  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [subsubId, setSubsubId] = useState("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [subsubs, setSubsubs] = useState<SubsubCategory[]>([]);

  // Edit drawer/modal
  const [editing, setEditing] = useState<Variant | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<"unit" | "weight">("unit");
  const [editPackKg, setEditPackKg] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editSku, setEditSku] = useState("");
  const [editActive, setEditActive] = useState(true);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return variants.filter((v) => {
      if (onlyActive && !v.is_active) return false;

      const prod = v.product;
      const subsub = prod?.subsub;
      const subcat = subsub?.subcategory;
      const cat = subcat?.category;

      if (categoryId && cat?.id !== categoryId) return false;
      if (subcategoryId && subcat?.id !== subcategoryId) return false;
      if (subsubId && subsub?.id !== subsubId) return false;

      if (!needle) return true;
      const hay = `${prod?.name ?? ""} ${prod?.brand ?? ""} ${v.name ?? ""} ${v.sku ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [variants, q, onlyActive, categoryId, subcategoryId, subsubId]);

  async function loadFilters() {
    // categories
    const { data: cData, error: cErr } = await supabase
      .from("categories")
      .select("id,name_en,name_so,slug")
      .order("name_en", { ascending: true, nullsFirst: false });
    if (cErr) throw cErr;
    setCategories(
      (cData ?? []).map((c: any) => ({
        id: String(c.id),
        name_en: c.name_en ?? null,
        name_so: c.name_so ?? null,
        slug: c.slug ?? null,
      }))
    );

    // subcategories (normalize category join to single object)
    const { data: scData, error: scErr } = await supabase
      .from("subcategories")
      .select("id,name_en,name_so,slug,category:categories(id,name_en,name_so,slug)")
      .order("name_en", { ascending: true, nullsFirst: false });
    if (scErr) throw scErr;

    const scNorm: Subcategory[] = (scData ?? []).map((row: any) => {
      const cat = asOne<any>(row.category);
      return {
        id: String(row.id),
        name_en: row.name_en ?? null,
        name_so: row.name_so ?? null,
        slug: row.slug ?? null,
        category: cat
          ? {
              id: String(cat.id),
              name_en: cat.name_en ?? null,
              name_so: cat.name_so ?? null,
              slug: cat.slug ?? null,
            }
          : null,
      };
    });
    setSubcategories(scNorm);

    // subsubcategories (normalize nested joins)
    const { data: ssData, error: ssErr } = await supabase
      .from("subsubcategories")
      .select(
        "id,name_en,name_so,slug,subcategory:subcategories(id,name_en,name_so,slug,category:categories(id,name_en,name_so,slug))"
      )
      .order("name_en", { ascending: true, nullsFirst: false });
    if (ssErr) throw ssErr;

    const ssNorm: SubsubCategory[] = (ssData ?? []).map((row: any) => {
      const subRaw = asOne<any>(row.subcategory);
      const catRaw = subRaw ? asOne<any>(subRaw.category) : null;

      const subcategory: Subcategory | null = subRaw
        ? {
            id: String(subRaw.id),
            name_en: subRaw.name_en ?? null,
            name_so: subRaw.name_so ?? null,
            slug: subRaw.slug ?? null,
            category: catRaw
              ? {
                  id: String(catRaw.id),
                  name_en: catRaw.name_en ?? null,
                  name_so: catRaw.name_so ?? null,
                  slug: catRaw.slug ?? null,
                }
              : null,
          }
        : null;

      return {
        id: String(row.id),
        name_en: row.name_en ?? null,
        name_so: row.name_so ?? null,
        slug: row.slug ?? null,
        subcategory,
      };
    });
    setSubsubs(ssNorm);
  }

  async function loadVariants() {
    const { data, error } = await supabase
      .from("product_variants")
      .select(
        "id,product_id,name,variant_type,pack_size_g,sell_price,sku,is_active,created_at,product:products(id,name,brand,is_active,subsub:subsubcategories(id,name_en,name_so,slug,subcategory:subcategories(id,name_en,name_so,slug,category:categories(id,name_en,name_so,slug))))"
      )
      .order("created_at", { ascending: false });
    if (error) throw error;

    // normalize product.subsub.subcategory.category when joins return arrays
    const norm: Variant[] = (data ?? []).map((v: any) => {
      const prod = asOne<any>(v.product) ?? v.product; // product may or may not be array
      const subsub = prod?.subsub ? asOne<any>(prod.subsub) : null;
      const subcat = subsub?.subcategory ? asOne<any>(subsub.subcategory) : null;
      const cat = subcat?.category ? asOne<any>(subcat.category) : null;

      const fixedProduct: Product | null = prod
        ? {
            id: String(prod.id),
            name: String(prod.name),
            brand: prod.brand ?? null,
            is_active: !!prod.is_active,
            subsub: subsub
              ? {
                  id: String(subsub.id),
                  name_en: subsub.name_en ?? null,
                  name_so: subsub.name_so ?? null,
                  slug: subsub.slug ?? null,
                  subcategory: subcat
                    ? {
                        id: String(subcat.id),
                        name_en: subcat.name_en ?? null,
                        name_so: subcat.name_so ?? null,
                        slug: subcat.slug ?? null,
                        category: cat
                          ? {
                              id: String(cat.id),
                              name_en: cat.name_en ?? null,
                              name_so: cat.name_so ?? null,
                              slug: cat.slug ?? null,
                            }
                          : null,
                      }
                    : null,
                }
              : null,
          }
        : null;

      return {
        id: String(v.id),
        product_id: String(v.product_id),
        name: String(v.name),
        variant_type: String(v.variant_type),
        pack_size_g: v.pack_size_g ?? null,
        sell_price: Number(v.sell_price ?? 0),
        sku: v.sku ?? null,
        is_active: !!v.is_active,
        created_at: v.created_at ?? undefined,
        product: fixedProduct,
      };
    });

    setVariants(norm);
  }

  async function refreshAll() {
    setLoading(true);
    setErrorMsg(null);
    try {
      await loadFilters();
      await loadVariants();
    } catch (e: any) {
      console.error("VariantsManagerSection refreshAll error:", e);
      setErrorMsg(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openEdit(v: Variant) {
    setEditing(v);
    setEditName(v.name ?? "");
    setEditType((v.variant_type as any) === "weight" ? "weight" : "unit");
    setEditPackKg(gToKgString(v.pack_size_g));
    setEditPrice(formatMoney(v.sell_price));
    setEditSku(v.sku ?? "");
    setEditActive(!!v.is_active);
  }

  function closeEdit() {
    setEditing(null);
  }

  async function saveEdit() {
    if (!editing) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      if (!editName.trim()) {
        setErrorMsg("Variant name is required.");
        return;
      }
      const priceNum = Number(editPrice);
      if (!Number.isFinite(priceNum)) {
        setErrorMsg("Sell price must be a number.");
        return;
      }

      const payload: any = {
        name: editName.trim(),
        variant_type: editType,
        pack_size_g: editType === "weight" ? kgToG(editPackKg) : null,
        sell_price: priceNum,
        sku: editSku.trim() || null,
        is_active: editActive,
      };

      const { data, error } = await supabase
        .from("product_variants")
        .update(payload)
        .eq("id", editing.id)
        .select(
          "id,product_id,name,variant_type,pack_size_g,sell_price,sku,is_active,created_at,product:products(id,name,brand,is_active,subsub:subsubcategories(id,name_en,name_so,slug,subcategory:subcategories(id,name_en,name_so,slug,category:categories(id,name_en,name_so,slug))))"
        )
        .single();

      if (error) throw error;

      // normalize returned row like loadVariants
      const prod = asOne<any>((data as any).product) ?? (data as any).product;
      const subsub = prod?.subsub ? asOne<any>(prod.subsub) : null;
      const subcat = subsub?.subcategory ? asOne<any>(subsub.subcategory) : null;
      const cat = subcat?.category ? asOne<any>(subcat.category) : null;

      const fixed: Variant = {
        id: String((data as any).id),
        product_id: String((data as any).product_id),
        name: String((data as any).name),
        variant_type: String((data as any).variant_type),
        pack_size_g: (data as any).pack_size_g ?? null,
        sell_price: Number((data as any).sell_price ?? 0),
        sku: (data as any).sku ?? null,
        is_active: !!(data as any).is_active,
        created_at: (data as any).created_at ?? undefined,
        product: prod
          ? {
              id: String(prod.id),
              name: String(prod.name),
              brand: prod.brand ?? null,
              is_active: !!prod.is_active,
              subsub: subsub
                ? {
                    id: String(subsub.id),
                    name_en: subsub.name_en ?? null,
                    name_so: subsub.name_so ?? null,
                    slug: subsub.slug ?? null,
                    subcategory: subcat
                      ? {
                          id: String(subcat.id),
                          name_en: subcat.name_en ?? null,
                          name_so: subcat.name_so ?? null,
                          slug: subcat.slug ?? null,
                          category: cat
                            ? {
                                id: String(cat.id),
                                name_en: cat.name_en ?? null,
                                name_so: cat.name_so ?? null,
                                slug: cat.slug ?? null,
                              }
                            : null,
                        }
                      : null,
                  }
                : null,
            }
          : null,
      };

      setVariants((prev) => prev.map((x) => (x.id === editing.id ? fixed : x)));
      closeEdit();
    } catch (e: any) {
      console.error("VariantsManagerSection saveEdit error:", e);
      setErrorMsg(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteVariant(v: Variant) {
    const ok = confirm(`Delete variant “${v.name}”? This cannot be undone.`);
    if (!ok) return;

    setLoading(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.from("product_variants").delete().eq("id", v.id);
      if (error) throw error;
      setVariants((prev) => prev.filter((x) => x.id !== v.id));
    } catch (e: any) {
      console.error("VariantsManagerSection deleteVariant error:", e);
      setErrorMsg(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  const visibleSubcats = useMemo(() => {
    if (!categoryId) return subcategories;
    return subcategories.filter((s) => s.category?.id === categoryId);
  }, [subcategories, categoryId]);

  const visibleSubsubs = useMemo(() => {
    if (!subcategoryId) return subsubs;
    return subsubs.filter((s) => s.subcategory?.id === subcategoryId);
  }, [subsubs, subcategoryId]);

  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Variants Manager</h2>
          <p className="mt-2 text-sm text-gray-600">
            Search, filter, and edit variants/products quickly. (Your original “Variants” section stays unchanged.)
          </p>
        </div>

        <button
          type="button"
          onClick={refreshAll}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {errorMsg && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
      )}

      <div className="mt-6 grid gap-3 rounded-xl border p-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className="text-xs text-gray-600">Search</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            placeholder="Product / brand / variant / SKU"
          />
        </div>

        <div>
          <label className="text-xs text-gray-600">Category</label>
          <select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setSubcategoryId("");
              setSubsubId("");
            }}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {displayName(c)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-600">Subcategory</label>
          <select
            value={subcategoryId}
            onChange={(e) => {
              setSubcategoryId(e.target.value);
              setSubsubId("");
            }}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All</option>
            {visibleSubcats.map((s) => (
              <option key={s.id} value={s.id}>
                {displayName(s)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-600">Sub-subcategory</label>
          <select
            value={subsubId}
            onChange={(e) => setSubsubId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All</option>
            {visibleSubsubs.map((s) => (
              <option key={s.id} value={s.id}>
                {displayName(s)}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-5 flex items-center gap-2">
          <input id="onlyActive" type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          <label htmlFor="onlyActive" className="text-sm text-gray-700">
            Only active
          </label>
          <div className="ml-auto text-sm text-gray-600">{filtered.length} result(s)</div>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Variant</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Pack</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => {
              const prod = v.product;
              const subsub = prod?.subsub;
              const subcat = subsub?.subcategory;
              const cat = subcat?.category;
              const catPath = [
                cat ? displayName(cat) : "",
                subcat ? displayName(subcat) : "",
                subsub ? displayName(subsub) : "",
              ]
                .filter(Boolean)
                .join(" / ");

              return (
                <tr key={v.id} className="border-t">
                  <td className="px-3 py-2 font-medium">
                    <div>{prod?.name ?? ""}</div>
                    {prod?.brand && <div className="text-xs text-gray-500">{prod.brand}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{v.name}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">{v.variant_type}</td>
                  <td className="px-3 py-2 text-xs text-gray-700">
                    {v.variant_type === "weight" && v.pack_size_g ? `${gToKgString(v.pack_size_g)}kg` : ""}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">{v.sell_price}</td>
                  <td className="px-3 py-2 text-xs text-gray-700">{v.sku ?? ""}</td>
                  <td className="px-3 py-2 text-xs text-gray-700">{catPath}</td>
                  <td className="px-3 py-2 text-xs text-gray-700">{v.is_active ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(v)}
                        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteVariant(v)}
                        className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-sm text-gray-500" colSpan={9}>
                  No results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-xl rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Edit Variant</div>
                <div className="mt-1 text-xs text-gray-600">
                  {editing.product?.name ?? ""} — {editing.name}
                </div>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-xs text-gray-600">Variant name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">Type</label>
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as any)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="unit">Unit</option>
                  <option value="weight">Weight</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-600">Pack size (kg)</label>
                <input
                  value={editPackKg}
                  onChange={(e) => setEditPackKg(e.target.value)}
                  inputMode="decimal"
                  step="0.001"
                  disabled={editType !== "weight"}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-50"
                  placeholder="e.g. 0.500"
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">Sell price</label>
                <input
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  inputMode="decimal"
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">SKU (optional)</label>
                <input
                  value={editSku}
                  onChange={(e) => setEditSku(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <label className="mt-2 flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
                <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
                Active
              </label>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={saveEdit} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white">
                {loading ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}