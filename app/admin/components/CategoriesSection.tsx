

"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Cat = { id: string; name: string; slug: string };
type Sub = { id: string; category_id: string; name: string; slug: string };
type SubSub = { id: string; subcategory_id: string; name: string; slug: string };

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export default function CategoriesSection() {
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [categories, setCategories] = useState<Cat[]>([]);
  const [subcategories, setSubcategories] = useState<Sub[]>([]);
  const [subsubs, setSubsubs] = useState<SubSub[]>([]);

  const [catName, setCatName] = useState("");
  const [subName, setSubName] = useState("");
  const [subsubName, setSubsubName] = useState("");

  const [selectedCatId, setSelectedCatId] = useState<string>("");
  const [selectedSubId, setSelectedSubId] = useState<string>("");

  const filteredSubs = useMemo(
    () => subcategories.filter((s) => s.category_id === selectedCatId),
    [subcategories, selectedCatId]
  );

  const filteredSubsubs = useMemo(
    () => subsubs.filter((ss) => ss.subcategory_id === selectedSubId),
    [subsubs, selectedSubId]
  );

  async function loadAll() {
    setErrorMsg(null);
    setLoading(true);
    try {
      const [{ data: cats, error: catsErr }, { data: subs, error: subsErr }, { data: ssubs, error: ssubsErr }] =
        await Promise.all([
          supabase.from("categories").select("id,name,slug").order("created_at", { ascending: false }),
          supabase.from("subcategories").select("id,category_id,name,slug").order("created_at", { ascending: false }),
          supabase
            .from("subsubcategories")
            .select("id,subcategory_id,name,slug")
            .order("created_at", { ascending: false }),
        ]);

      if (catsErr) throw catsErr;
      if (subsErr) throw subsErr;
      if (ssubsErr) throw ssubsErr;

      setCategories((cats ?? []) as Cat[]);
      setSubcategories((subs ?? []) as Sub[]);
      setSubsubs((ssubs ?? []) as SubSub[]);
    } catch (e: any) {
      console.error("CategoriesSection loadAll error:", e);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addCategory() {
    const name = catName.trim();
    if (!name) return;

    setErrorMsg(null);
    setBusyKey("add-category");
    try {
      const slug = slugify(name);

      const { data, error } = await supabase
        .from("categories")
        .insert({ name, slug })
        .select("id,name,slug")
        .single();

      if (error) throw error;

      setCategories((prev) => [data as Cat, ...prev]);
      setCatName("");
    } catch (e: any) {
      console.error("addCategory error:", e);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function addSubcategory() {
    const name = subName.trim();
    if (!name || !selectedCatId) return;

    setErrorMsg(null);
    setBusyKey("add-subcategory");
    try {
      const slug = slugify(name);

      const { data, error } = await supabase
        .from("subcategories")
        .insert({ category_id: selectedCatId, name, slug })
        .select("id,category_id,name,slug")
        .single();

      if (error) throw error;

      setSubcategories((prev) => [data as Sub, ...prev]);
      setSubName("");
    } catch (e: any) {
      console.error("addSubcategory error:", e);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function addSubsub() {
    const name = subsubName.trim();
    if (!name || !selectedSubId) return;

    setErrorMsg(null);
    setBusyKey("add-subsub");
    try {
      const slug = slugify(name);

      const { data, error } = await supabase
        .from("subsubcategories")
        .insert({ subcategory_id: selectedSubId, name, slug })
        .select("id,subcategory_id,name,slug")
        .single();

      if (error) throw error;

      setSubsubs((prev) => [data as SubSub, ...prev]);
      setSubsubName("");
    } catch (e: any) {
      console.error("addSubsub error:", e);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setBusyKey(null);
    }
  }

  // Safe manual cascade deletes (works even if FK cascade isn't configured)
  async function removeCategory(id: string) {
    setErrorMsg(null);
    setBusyKey(`del-cat:${id}`);

    try {
      // 1) find subcategories under this category
      const subsToRemove = subcategories.filter((s) => s.category_id === id).map((s) => s.id);

      // 2) delete subsubcategories under those subcategories
      if (subsToRemove.length > 0) {
        const { error: delSubsubsErr } = await supabase
          .from("subsubcategories")
          .delete()
          .in("subcategory_id", subsToRemove);

        if (delSubsubsErr) throw delSubsubsErr;

        const { error: delSubsErr } = await supabase.from("subcategories").delete().eq("category_id", id);
        if (delSubsErr) throw delSubsErr;
      } else {
        // no subs, but still try deleting subs just in case
        const { error: delSubsErr } = await supabase.from("subcategories").delete().eq("category_id", id);
        if (delSubsErr) throw delSubsErr;
      }

      const { error: delCatErr } = await supabase.from("categories").delete().eq("id", id);
      if (delCatErr) throw delCatErr;

      // update local state
      setSubsubs((prev) => prev.filter((ss) => !subsToRemove.includes(ss.subcategory_id)));
      setSubcategories((prev) => prev.filter((s) => s.category_id !== id));
      setCategories((prev) => prev.filter((c) => c.id !== id));

      if (selectedCatId === id) setSelectedCatId("");
      if (subsToRemove.includes(selectedSubId)) setSelectedSubId("");
    } catch (e: any) {
      console.error("removeCategory error:", e);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function removeSubcategory(id: string) {
    setErrorMsg(null);
    setBusyKey(`del-sub:${id}`);

    try {
      const { error: delSubsubsErr } = await supabase.from("subsubcategories").delete().eq("subcategory_id", id);
      if (delSubsubsErr) throw delSubsubsErr;

      const { error: delSubErr } = await supabase.from("subcategories").delete().eq("id", id);
      if (delSubErr) throw delSubErr;

      setSubsubs((prev) => prev.filter((ss) => ss.subcategory_id !== id));
      setSubcategories((prev) => prev.filter((s) => s.id !== id));
      if (selectedSubId === id) setSelectedSubId("");
    } catch (e: any) {
      console.error("removeSubcategory error:", e);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function removeSubsub(id: string) {
    setErrorMsg(null);
    setBusyKey(`del-subsub:${id}`);

    try {
      const { error } = await supabase.from("subsubcategories").delete().eq("id", id);
      if (error) throw error;

      setSubsubs((prev) => prev.filter((ss) => ss.id !== id));
    } catch (e: any) {
      console.error("removeSubsub error:", e);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="max-w-full overflow-x-hidden text-gray-900">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Categories</h2>
          <p className="mt-2 text-sm text-gray-600">
            Category → Subcategory → Sub-subcategory (Supabase-backed).
          </p>
        </div>

        <button
          type="button"
          onClick={loadAll}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {errorMsg && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-semibold">DB error</div>
          <div className="mt-1 break-words">{errorMsg}</div>
          <div className="mt-2 text-xs text-red-700">Tip: check DevTools Console for full logs.</div>
        </div>
      )}

      <div className="mt-6 grid max-w-full gap-4 lg:grid-cols-3">
        {/* Categories */}
        <div className="min-w-0 rounded-xl border p-4">
          <div className="text-sm font-medium">Categories</div>

          <div className="mt-3 flex gap-2">
            <input
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
              placeholder="e.g. Grocery"
            />
            <button
              type="button"
              onClick={addCategory}
              disabled={busyKey === "add-category"}
              className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {busyKey === "add-category" ? "Adding..." : "Add"}
            </button>
          </div>

          <ul className="mt-4 space-y-2">
            {categories.map((c) => (
              <li
                key={c.id}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                  selectedCatId === c.id ? "border-gray-900" : ""
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setSelectedCatId(c.id);
                    setSelectedSubId("");
                  }}
                >
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="truncate text-xs text-gray-500">{c.slug}</div>
                </button>

                <button
                  type="button"
                  onClick={() => removeCategory(c.id)}
                  disabled={busyKey === `del-cat:${c.id}`}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  {busyKey === `del-cat:${c.id}` ? "Deleting..." : "Delete"}
                </button>
              </li>
            ))}

            {!loading && categories.length === 0 && (
              <li className="text-sm text-gray-500">No categories yet.</li>
            )}
          </ul>
        </div>

        {/* Subcategories */}
        <div className="min-w-0 rounded-xl border p-4">
          <div className="text-sm font-medium">Subcategories</div>
          <p className="mt-1 text-xs text-gray-500">Select a category first.</p>

          <div className="mt-3 flex gap-2">
            <input
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
              placeholder="e.g. Pasta & Noodles"
              disabled={!selectedCatId}
            />
            <button
              type="button"
              onClick={addSubcategory}
              disabled={!selectedCatId || busyKey === "add-subcategory"}
              className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {busyKey === "add-subcategory" ? "Adding..." : "Add"}
            </button>
          </div>

          <ul className="mt-4 space-y-2">
            {filteredSubs.map((s) => (
              <li
                key={s.id}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                  selectedSubId === s.id ? "border-gray-900" : ""
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setSelectedSubId(s.id)}
                >
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="truncate text-xs text-gray-500">{s.slug}</div>
                </button>

                <button
                  type="button"
                  onClick={() => removeSubcategory(s.id)}
                  disabled={busyKey === `del-sub:${s.id}`}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  {busyKey === `del-sub:${s.id}` ? "Deleting..." : "Delete"}
                </button>
              </li>
            ))}

            {!selectedCatId && <li className="text-sm text-gray-500">Pick a category.</li>}

            {selectedCatId && filteredSubs.length === 0 && (
              <li className="text-sm text-gray-500">No subcategories yet.</li>
            )}
          </ul>
        </div>

        {/* Sub-subcategories */}
        <div className="min-w-0 rounded-xl border p-4">
          <div className="text-sm font-medium">Sub-subcategories</div>
          <p className="mt-1 text-xs text-gray-500">Select a subcategory first.</p>

          <div className="mt-3 flex gap-2">
            <input
              value={subsubName}
              onChange={(e) => setSubsubName(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
              placeholder="e.g. Pasta"
              disabled={!selectedSubId}
            />
            <button
              type="button"
              onClick={addSubsub}
              disabled={!selectedSubId || busyKey === "add-subsub"}
              className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {busyKey === "add-subsub" ? "Adding..." : "Add"}
            </button>
          </div>

          <ul className="mt-4 space-y-2">
            {filteredSubsubs.map((ss) => (
              <li
                key={ss.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{ss.name}</div>
                  <div className="truncate text-xs text-gray-500">{ss.slug}</div>
                </div>

                <button
                  type="button"
                  onClick={() => removeSubsub(ss.id)}
                  disabled={busyKey === `del-subsub:${ss.id}`}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50"
                >
                  {busyKey === `del-subsub:${ss.id}` ? "Deleting..." : "Delete"}
                </button>
              </li>
            ))}

            {!selectedSubId && <li className="text-sm text-gray-500">Pick a subcategory.</li>}

            {selectedSubId && filteredSubsubs.length === 0 && (
              <li className="text-sm text-gray-500">No sub-subcategories yet.</li>
            )}
          </ul>
        </div>
      </div>

      <div className="mt-6 rounded-xl border bg-gray-50 p-4 text-sm text-gray-600">
        <div>
          If inserts fail with <b>permission denied</b>, your Supabase RLS is blocking writes. For dev, disable RLS on:
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <code className="rounded bg-white px-2 py-1 text-xs">categories</code>
          <code className="rounded bg-white px-2 py-1 text-xs">subcategories</code>
          <code className="rounded bg-white px-2 py-1 text-xs">subsubcategories</code>
        </div>
      </div>
    </div>
  );
}
