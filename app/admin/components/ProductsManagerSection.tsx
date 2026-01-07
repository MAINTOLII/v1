"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Category = { id: string; name: string; slug?: string | null };
type Subcategory = { id: string; name: string; slug?: string | null; category?: Category | null };
type SubsubCategory = {
  id: string;
  name: string;
  slug?: string | null;
  subcategory?: Subcategory | null;
};

type Product = {
  id: string;
  subsubcat_id: string;
  name: string;
  slug: string | null;
  description: string | null;
  tags: string[];
  brand: string | null;
  is_active: boolean;
  created_at?: string;
  subsub?: SubsubCategory | null;
};

function asOne<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
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
  } catch {}
  return "Unknown error (check console)";
}

function slugify(input: string) {
  return (input ?? "")
    .toLowerCase()
    .trim()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function parseTags(input: string): string[] {
  const raw = (input ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function normalizeTags(v: any): string[] {
  if (Array.isArray(v)) return v.filter(Boolean).map((x: any) => String(x));
  if (typeof v === "string") return parseTags(v);
  return [];
}

function displayName(row: any) {
  return String(row?.name_en ?? row?.name_so ?? row?.name ?? "");
}

export default function ProductsManagerSection() {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>([]);

  // Filters
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [subsubId, setSubsubId] = useState("");

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [subsubs, setSubsubs] = useState<SubsubCategory[]>([]);

  // Create form
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newSubsubId, setNewSubsubId] = useState("");
  const [newActive, setNewActive] = useState(true);

  // Edit modal
  const [editing, setEditing] = useState<Product | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editBrand, setEditBrand] = useState("");
  const [editSubsubId, setEditSubsubId] = useState("");
  const [editActive, setEditActive] = useState(true);

  const visibleSubcats = useMemo(() => {
    if (!categoryId) return subcategories;
    return subcategories.filter((s) => s.category?.id === categoryId);
  }, [subcategories, categoryId]);

  const visibleSubsubs = useMemo(() => {
    if (!subcategoryId) return subsubs;
    return subsubs.filter((s) => s.subcategory?.id === subcategoryId);
  }, [subsubs, subcategoryId]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => {
      if (onlyActive && !p.is_active) return false;

      const subsub = p.subsub;
      const subcat = subsub?.subcategory;
      const cat = subcat?.category;

      if (categoryId && cat?.id !== categoryId) return false;
      if (subcategoryId && subcat?.id !== subcategoryId) return false;
      if (subsubId && subsub?.id !== subsubId) return false;

      if (!needle) return true;
      const hay = `${p.name ?? ""} ${p.slug ?? ""} ${p.brand ?? ""} ${p.description ?? ""} ${(p.tags ?? []).join(
        " "
      )}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [products, q, onlyActive, categoryId, subcategoryId, subsubId]);

  async function loadFilters() {
    const { data: cData, error: cErr } = await supabase.from("categories").select("id,name_en,name_so,slug").order("name_en");
    if (cErr) throw cErr;
    setCategories(
      (cData ?? []).map((r: any) => ({
        id: String(r.id),
        name: displayName(r),
        slug: r.slug ?? null,
      }))
    );

    const { data: scData, error: scErr } = await supabase
      .from("subcategories")
      .select("id,name_en,name_so,slug,category:categories!subcategories_category_id_fkey(id,name_en,name_so,slug)")
      .order("name_en");
    if (scErr) throw scErr;

    const scNorm: Subcategory[] = (scData ?? []).map((row: any) => ({
      id: String(row.id),
      name: displayName(row),
      slug: row.slug ?? null,
      category: asOne<Category>(row.category),
    }));
    setSubcategories(scNorm);

    const { data: ssData, error: ssErr } = await supabase
      .from("subsubcategories")
      .select(
        "id,name_en,name_so,slug,subcategory:subcategories!subsubcategories_subcategory_id_fkey(id,name_en,name_so,slug,category:categories!subcategories_category_id_fkey(id,name_en,name_so,slug))"
      )
      .order("name_en");
    if (ssErr) throw ssErr;

    const ssNorm: SubsubCategory[] = (ssData ?? []).map((row: any) => {
      const subcatRaw = asOne<any>(row.subcategory);
      const catRaw = subcatRaw ? asOne<any>(subcatRaw.category) : null;

      const subcat: Subcategory | null = subcatRaw
        ? {
            id: String(subcatRaw.id),
            name: displayName(subcatRaw),
            slug: subcatRaw.slug ?? null,
            category: catRaw
              ? {
                  id: String(catRaw.id),
                  name: displayName(catRaw),
                  slug: catRaw.slug ?? null,
                }
              : null,
          }
        : null;

      return {
        id: String(row.id),
        name: displayName(row),
        slug: row.slug ?? null,
        subcategory: subcat,
      };
    });

    setSubsubs(ssNorm);
  }

  async function loadProducts() {
    const { data, error } = await supabase
      .from("products")
      .select(
        "id,subsubcat_id,name,slug,description,tags,brand,is_active,created_at,subsub:subsubcategories!products_subsubcat_id_fkey(id,name_en,name_so,slug,subcategory:subcategories!subsubcategories_subcategory_id_fkey(id,name_en,name_so,slug,category:categories!subcategories_category_id_fkey(id,name_en,name_so,slug)))"
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    const pNorm: Product[] = (data ?? []).map((row: any) => {
      const subsubRaw = asOne<any>(row.subsub);
      const subcatRaw = subsubRaw ? asOne<any>(subsubRaw.subcategory) : null;
      const catRaw = subcatRaw ? asOne<any>(subcatRaw.category) : null;

      const subcat: Subcategory | null = subcatRaw
        ? {
            id: String(subcatRaw.id),
            name: displayName(subcatRaw),
            slug: subcatRaw.slug ?? null,
            category: catRaw
              ? {
                  id: String(catRaw.id),
                  name: displayName(catRaw),
                  slug: catRaw.slug ?? null,
                }
              : null,
          }
        : null;

      const subsub: SubsubCategory | null = subsubRaw
        ? {
            id: String(subsubRaw.id),
            name: displayName(subsubRaw),
            slug: subsubRaw.slug ?? null,
            subcategory: subcat,
          }
        : null;

      return {
        id: String(row.id),
        subsubcat_id: String(row.subsubcat_id),
        name: String(row.name),
        slug: row.slug ?? null,
        description: row.description ?? null,
        tags: normalizeTags(row.tags),
        brand: row.brand ?? null,
        is_active: !!row.is_active,
        created_at: row.created_at,
        subsub,
      };
    });

    setProducts(pNorm);
  }

  async function refreshAll() {
    setLoading(true);
    setErrorMsg(null);
    try {
      await loadFilters();
      await loadProducts();
    } catch (e: any) {
      console.error("ProductsManagerSection refreshAll error:", e);
      setErrorMsg(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createProduct() {
    setLoading(true);
    setErrorMsg(null);
    try {
      if (!newName.trim()) {
        setErrorMsg("Product name is required.");
        return;
      }
      if (!newSubsubId) {
        setErrorMsg("Please select a sub-subcategory.");
        return;
      }

      const cleanName = newName.trim();
      const cleanSlug = (newSlug.trim() ? slugify(newSlug.trim()) : slugify(cleanName)) || null;
      const cleanDesc = newDescription.trim() || null;
      const cleanTags = parseTags(newTags);

      const payload = {
        name: cleanName,
        slug: cleanSlug,
        description: cleanDesc,
        tags: cleanTags,
        brand: newBrand.trim() || null,
        subsubcat_id: newSubsubId,
        is_active: newActive,
      };

      const { data, error } = await supabase
        .from("products")
        .insert(payload)
        .select(
          "id,subsubcat_id,name,slug,description,tags,brand,is_active,created_at,subsub:subsubcategories!products_subsubcat_id_fkey(id,name_en,name_so,slug,subcategory:subcategories!subsubcategories_subcategory_id_fkey(id,name_en,name_so,slug,category:categories!subcategories_category_id_fkey(id,name_en,name_so,slug)))"
        )
        .single();

      if (error) throw error;

      const row: any = data;
      const subsubRaw = asOne<any>(row.subsub);
      const subcatRaw = subsubRaw ? asOne<any>(subsubRaw.subcategory) : null;
      const catRaw = subcatRaw ? asOne<any>(subcatRaw.category) : null;

      const subcat: Subcategory | null = subcatRaw
        ? {
            id: String(subcatRaw.id),
            name: displayName(subcatRaw),
            slug: subcatRaw.slug ?? null,
            category: catRaw
              ? {
                  id: String(catRaw.id),
                  name: displayName(catRaw),
                  slug: catRaw.slug ?? null,
                }
              : null,
          }
        : null;

      const subsub: SubsubCategory | null = subsubRaw
        ? {
            id: String(subsubRaw.id),
            name: displayName(subsubRaw),
            slug: subsubRaw.slug ?? null,
            subcategory: subcat,
          }
        : null;

      const normalized: Product = {
        id: String(row.id),
        subsubcat_id: String(row.subsubcat_id),
        name: String(row.name),
        slug: row.slug ?? null,
        description: row.description ?? null,
        tags: normalizeTags(row.tags),
        brand: row.brand ?? null,
        is_active: !!row.is_active,
        created_at: row.created_at,
        subsub,
      };

      setProducts((prev) => [normalized, ...prev]);

      setNewName("");
      setNewSlug("");
      setNewDescription("");
      setNewTags("");
      setNewBrand("");
      setNewSubsubId("");
      setNewActive(true);
    } catch (e: any) {
      console.error("ProductsManagerSection createProduct error:", e);
      setErrorMsg(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  function openEdit(p: Product) {
    setEditing(p);
    setEditName(p.name ?? "");
    setEditSlug(p.slug ?? "");
    setEditDescription(p.description ?? "");
    setEditTags((p.tags ?? []).join(", "));
    setEditBrand(p.brand ?? "");
    setEditSubsubId(p.subsubcat_id ?? "");
    setEditActive(!!p.is_active);
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
        setErrorMsg("Product name is required.");
        return;
      }
      if (!editSubsubId) {
        setErrorMsg("Please select a sub-subcategory.");
        return;
      }

      const cleanName = editName.trim();
      const cleanSlug = (editSlug.trim() ? slugify(editSlug.trim()) : slugify(cleanName)) || null;
      const cleanDesc = editDescription.trim() || null;
      const cleanTags = parseTags(editTags);

      const payload = {
        name: cleanName,
        slug: cleanSlug,
        description: cleanDesc,
        tags: cleanTags,
        brand: editBrand.trim() || null,
        subsubcat_id: editSubsubId,
        is_active: editActive,
      };

      const { data, error } = await supabase
        .from("products")
        .update(payload)
        .eq("id", editing.id)
        .select(
          "id,subsubcat_id,name,slug,description,tags,brand,is_active,created_at,subsub:subsubcategories!products_subsubcat_id_fkey(id,name_en,name_so,slug,subcategory:subcategories!subsubcategories_subcategory_id_fkey(id,name_en,name_so,slug,category:categories!subcategories_category_id_fkey(id,name_en,name_so,slug)))"
        )
        .single();

      if (error) throw error;

      const row: any = data;
      const subsubRaw = asOne<any>(row.subsub);
      const subcatRaw = subsubRaw ? asOne<any>(subsubRaw.subcategory) : null;
      const catRaw = subcatRaw ? asOne<any>(subcatRaw.category) : null;

      const subcat: Subcategory | null = subcatRaw
        ? {
            id: String(subcatRaw.id),
            name: displayName(subcatRaw),
            slug: subcatRaw.slug ?? null,
            category: catRaw
              ? {
                  id: String(catRaw.id),
                  name: displayName(catRaw),
                  slug: catRaw.slug ?? null,
                }
              : null,
          }
        : null;

      const subsub: SubsubCategory | null = subsubRaw
        ? {
            id: String(subsubRaw.id),
            name: displayName(subsubRaw),
            slug: subsubRaw.slug ?? null,
            subcategory: subcat,
          }
        : null;

      const normalized: Product = {
        id: String(row.id),
        subsubcat_id: String(row.subsubcat_id),
        name: String(row.name),
        slug: row.slug ?? null,
        description: row.description ?? null,
        tags: normalizeTags(row.tags),
        brand: row.brand ?? null,
        is_active: !!row.is_active,
        created_at: row.created_at,
        subsub,
      };

      setProducts((prev) => prev.map((x) => (x.id === editing.id ? normalized : x)));
      closeEdit();
    } catch (e: any) {
      console.error("ProductsManagerSection saveEdit error:", e);
      setErrorMsg(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteProduct(p: Product) {
    const ok = confirm(
      `Delete product “${p.name}”?\n\nWarning: If it has variants, the delete may fail unless you delete variants first.`
    );
    if (!ok) return;

    setLoading(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.from("products").delete().eq("id", p.id);
      if (error) throw error;
      setProducts((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e: any) {
      console.error("ProductsManagerSection deleteProduct error:", e);
      setErrorMsg(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  function catPathFor(p: Product) {
    const cat = p.subsub?.subcategory?.category ? displayName(p.subsub.subcategory.category) : undefined;
    const subcat = p.subsub?.subcategory ? displayName(p.subsub.subcategory) : undefined;
    const subsub = p.subsub ? displayName(p.subsub) : undefined;
    return [cat, subcat, subsub].filter(Boolean).join(" / ");
  }

  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Products Manager</h2>
          <p className="mt-2 text-sm text-gray-600">Search, filter, and manage products quickly.</p>
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

      {/* Create */}
      <div className="mt-6 rounded-xl border p-4">
        <div className="text-sm font-semibold">Create product</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="text-xs text-gray-600">Name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="e.g. Tomatoes"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Slug (optional)</label>
            <input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="auto-from name"
            />
          </div>

          <div className="sm:col-span-4">
            <label className="text-xs text-gray-600">Description (optional)</label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              rows={3}
              placeholder="Short description..."
            />
          </div>

          <div className="sm:col-span-4">
            <label className="text-xs text-gray-600">Tags (comma separated)</label>
            <input
              value={newTags}
              onChange={(e) => setNewTags(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="e.g. fresh, organic, imported"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Brand (optional)</label>
            <input
              value={newBrand}
              onChange={(e) => setNewBrand(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="e.g. Al Burj"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Sub-subcategory</label>
            <select
              value={newSubsubId}
              onChange={(e) => setNewSubsubId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {subsubs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.subcategory?.category?.name ?? ""} / {s.subcategory?.name ?? ""} / {s.name}
                </option>
              ))}
            </select>
          </div>

          <label className="mt-1 flex items-center gap-2 text-sm text-gray-700 sm:col-span-4">
            <input type="checkbox" checked={newActive} onChange={(e) => setNewActive(e.target.checked)} />
            Active
          </label>

          <div className="sm:col-span-4">
            <button type="button" onClick={createProduct} className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white">
              {loading ? "Saving…" : "Create"}
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 grid gap-3 rounded-xl border p-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className="text-xs text-gray-600">Search</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            placeholder="Product name / slug / tags / brand"
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
                {c.name}
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
                {s.name}
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
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-5 flex items-center gap-2">
          <input id="pmOnlyActive" type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          <label htmlFor="pmOnlyActive" className="text-sm text-gray-700">
            Only active
          </label>
          <div className="ml-auto text-sm text-gray-600">{filtered.length} result(s)</div>
        </div>
      </div>

      {/* Table */}
      <div className="mt-6 overflow-x-auto rounded-xl border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2">Product / Slug</th>
              <th className="px-3 py-2">Brand</th>
              <th className="px-3 py-2">Tags</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2">
                  <div className="font-medium">{p.name}</div>
                  {p.slug && <div className="text-xs text-gray-600">/{p.slug}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-700">{p.brand ?? ""}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{(p.tags ?? []).join(", ")}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{catPathFor(p)}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{p.is_active ? "Yes" : "No"}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(p)}
                      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteProduct(p)}
                      className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-sm text-gray-500" colSpan={6}>
                  No results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-xl rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Edit Product</div>
                <div className="mt-1 text-xs text-gray-600">{editing.name}</div>
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
                <label className="text-xs text-gray-600">Name</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs text-gray-600">Slug (optional)</label>
                <input
                  value={editSlug}
                  onChange={(e) => setEditSlug(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  placeholder="auto-from name"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs text-gray-600">Description (optional)</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  rows={3}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs text-gray-600">Tags (comma separated)</label>
                <input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  placeholder="e.g. fresh, organic"
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">Brand (optional)</label>
                <input
                  value={editBrand}
                  onChange={(e) => setEditBrand(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">Sub-subcategory</label>
                <select
                  value={editSubsubId}
                  onChange={(e) => setEditSubsubId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select…</option>
                  {subsubs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subcategory?.category ? displayName(s.subcategory.category) : ""} / {s.subcategory ? displayName(s.subcategory) : ""} / {displayName(s)}
                    </option>
                  ))}
                </select>
              </div>

              <label className="mt-1 flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
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