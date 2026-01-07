"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function parseTags(input: string): string[] {
  const arr = input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  // de-dupe (case-insensitive) but keep original casing of first occurrence
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of arr) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

type SubSub = {
  id: string;
  name_en: string | null;
  name_so: string | null;
};

type ProductRow = {
  id: string;
  name: string;
  brand: string | null;
  is_active: boolean;
  subsubcat_id: string | null;
  subsub?: { id: string; name_en: string | null; name_so: string | null } | null;
  slug: string | null;
  description: string | null;
  tags: string[] | null;
};

type Product = {
  id: string;
  name: string;
  brand: string | null;
  isActive: boolean;
  subsubcatId: string | null;
  subsubcatName: string;
  slug: string | null;
  description: string | null;
  tags: string[];
};

export default function ProductsSection() {
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [subsubs, setSubsubs] = useState<SubSub[]>([]);
  const [products, setProducts] = useState<Product[]>([]);

  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [subsubcatId, setSubsubcatId] = useState<string>("");

  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [tagsText, setTagsText] = useState("");

  const canAdd = useMemo(() => {
    return name.trim().length > 0 && subsubcatId.trim().length > 0;
  }, [name, subsubcatId]);

  async function loadSubsubs() {
    try {
      const { data, error } = await supabase
        .from("subsubcategories")
        .select("id,name_en,name_so")
        .order("name_en", { ascending: true });

      if (error) throw error;

      setSubsubs(
        (data ?? []).map((r: any) => ({
          id: r.id,
          name_en: r.name_en ?? null,
          name_so: r.name_so ?? null,
        }))
      );
    } catch (e: any) {
      console.error("loadSubsubs error:", e);
      setErrorMsg((prev) => prev ?? `Failed to load sub-subcategories: ${e?.message ?? String(e)}`);
    }
  }

  async function loadProducts() {
    setErrorMsg(null);
    setLoading(true);
    try {
      // Join to subsubcategories so we can display the name
      const { data, error } = await supabase
        .from("products")
        .select(
          "id,name,brand,is_active,subsubcat_id,slug,description,tags,subsub:subsubcategories!products_subsubcat_id_fkey(id,name_en,name_so)"
        )
        .order("created_at", { ascending: false });

      if (error) throw error;

      const rows = (data ?? []) as unknown as ProductRow[];

      setProducts(
        rows.map((p) => ({
          id: p.id,
          name: p.name,
          brand: p.brand ?? null,
          isActive: !!p.is_active,
          subsubcatId: p.subsubcat_id ?? null,
          subsubcatName: p.subsub?.name_en ?? p.subsub?.name_so ?? "—",
          slug: (p as any).slug ?? null,
          description: (p as any).description ?? null,
          tags: Array.isArray((p as any).tags) ? ((p as any).tags as string[]) : [],
        }))
      );
    } catch (e: any) {
      console.error("loadProducts error:", e);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Load both on mount
    loadSubsubs();
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addProduct() {
    if (!canAdd) return;

    setErrorMsg(null);
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        brand: brand.trim() || null,
        subsubcat_id: subsubcatId,
        slug: (slug.trim() ? slugify(slug) : slugify(name)).trim() || null,
        description: description.trim() || null,
        tags: parseTags(tagsText),
        is_active: true,
      };

      const { data, error } = await supabase
        .from("products")
        .insert(payload)
        .select(
          "id,name,brand,is_active,subsubcat_id,slug,description,tags,subsub:subsubcategories!products_subsubcat_id_fkey(id,name_en,name_so)"
        )
        .single();

      if (error) throw error;

      const row = data as unknown as ProductRow;

      setProducts((prev) => [
        {
          id: row.id,
          name: row.name,
          brand: row.brand ?? null,
          isActive: !!row.is_active,
          subsubcatId: row.subsubcat_id ?? null,
          subsubcatName: row.subsub?.name_en ?? row.subsub?.name_so ?? "—",
          slug: (row as any).slug ?? null,
          description: (row as any).description ?? null,
          tags: Array.isArray((row as any).tags) ? (((row as any).tags as string[]) ?? []) : [],
        },
        ...prev,
      ]);

      setName("");
      setBrand("");
      setSubsubcatId("");
      setSlug("");
      setDescription("");
      setTagsText("");
    } catch (e: any) {
      console.error("addProduct error:", e);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(id: string) {
    const current = products.find((p) => p.id === id);
    if (!current) return;

    setErrorMsg(null);
    setBusyId(id);

    const nextActive = !current.isActive;
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, isActive: nextActive } : p)));

    try {
      const { error } = await supabase.from("products").update({ is_active: nextActive }).eq("id", id);
      if (error) throw error;
    } catch (e: any) {
      console.error("toggleActive error:", e);
      setErrorMsg(e?.message ?? String(e));
      setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, isActive: current.isActive } : p)));
    } finally {
      setBusyId(null);
    }
  }

  async function removeProduct(id: string) {
    setErrorMsg(null);
    setBusyId(id);

    const prev = products;
    setProducts((p) => p.filter((x) => x.id !== id));

    try {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    } catch (e: any) {
      console.error("removeProduct error:", e);
      setErrorMsg(e?.message ?? String(e));
      setProducts(prev);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Products</h2>
          <p className="mt-2 text-sm text-gray-600">
            Fixed: this now uses <b>products.subsubcat_id</b> (FK) instead of <b>products.subsubcat</b>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadSubsubs}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
          >
            Refresh subsubs
          </button>
          <button
            type="button"
            onClick={loadProducts}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
          >
            Refresh products
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-semibold">DB error</div>
          <div className="mt-1 break-words">{errorMsg}</div>
          <div className="mt-2 text-xs text-red-700">
            Tip: open DevTools Console — we also log the full error there.
          </div>
        </div>
      )}

      {/* Add product */}
      <div className="mt-6 rounded-xl border p-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="text-xs text-gray-600">Product name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
              placeholder="e.g. Al Burj Pasta"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Brand (optional)</label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
              placeholder="e.g. Al Burj"
            />
          </div>

          <div className="md:col-span-3">
            <label className="text-xs text-gray-600">Slug (optional)</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
              placeholder="e.g. al-burj-pasta"
            />
            <p className="mt-1 text-xs text-gray-500">
              If empty, we auto-generate from the product name.
            </p>
          </div>

          <div className="md:col-span-3">
            <label className="text-xs text-gray-600">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
              placeholder="Short product description…"
            />
          </div>

          <div className="md:col-span-3">
            <label className="text-xs text-gray-600">Tags (comma separated)</label>
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400"
              placeholder="e.g. pasta, italian, dinner"
            />
          </div>

          <div className="md:col-span-3">
            <label className="text-xs text-gray-600">Sub-subcategory</label>
            <select
              value={subsubcatId}
              onChange={(e) => setSubsubcatId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="">Select sub-subcategory…</option>
              {subsubs.map((ss) => (
                <option key={ss.id} value={ss.id}>
                  {(ss.name_en ?? ss.name_so ?? "—") + (ss.name_so ? ` / ${ss.name_so}` : "")}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              If this list is empty, add sub-subcategories in the Categories section first.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={addProduct}
            disabled={!canAdd || loading}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {loading ? "Saving..." : "Add Product"}
          </button>

          <div className="text-xs text-gray-500">{loading ? "Talking to DB…" : "Ready"}</div>
        </div>
      </div>

      {/* Product list */}
      <div className="mt-6">
        <div className="text-sm font-medium">Products</div>

        <div className="mt-3 space-y-2">
          {products.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl border p-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="font-medium">{p.name}</div>
                  {!p.isActive && (
                    <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
                      inactive
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {p.brand ? `${p.brand} • ` : ""}
                  {p.subsubcatName}
                  {p.slug ? ` • /${p.slug}` : ""}
                </div>
                {p.tags.length > 0 && (
                  <div className="mt-1 text-xs text-gray-500">
                    Tags: {p.tags.join(", ")}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => toggleActive(p.id)}
                  disabled={busyId === p.id}
                  className="text-xs text-blue-600 hover:underline disabled:opacity-50"
                >
                  {p.isActive ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  onClick={() => removeProduct(p.id)}
                  disabled={busyId === p.id}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}

          {!loading && products.length === 0 && (
            <div className="text-sm text-gray-500">No products in DB yet. Add your first product above.</div>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">
        If you still get a join error, it means Supabase can't infer the relationship.
        In that case, we will show the raw UUID and map it manually — but try this first.
      </div>
    </div>
  );
}
