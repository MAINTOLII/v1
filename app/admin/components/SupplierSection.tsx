"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type SupplierDbRow = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  created_at: string;
};

type SupplierProductRow = {
  id: string;
  supplier_id: string;
  variant_id: string;
  is_primary: boolean;
  supplier_sku: string | null;
  default_buy_price: number | null;
  active: boolean;
  created_at: string;
  variant?: {
    id: string;
    name: string;
    variant_type: string;
    pack_size_g: number | null;
    product?: { name: string; brand: string | null } | null;
  } | null;
};

type VariantSearchRow = {
  id: string;
  name: string;
  variant_type: string;
  pack_size_g: number | null;
  sku: string | null;
  sell_price: number | null;
  is_active: boolean | null;
  product?: { id: string; name: string; brand: string | null } | null;
};

type SupplierRow = {
  supplier_name: string;
  restocks_count: number;
  total_cost: number;
  last_restock_at: string | null;
};

type MovementRow = {
  id: string;
  created_at: string;
  type: string;
  qty_g: number | string | null; // bigint can come back as string
  qty_units: number | string | null; // bigint can come back as string
  cost_total: number | null;
  supplier_name: string | null;
  note: string | null;
  variant?: {
    id: string;
    name: string;
    variant_type: string;
    pack_size_g: number | null;
    product?: { name: string; brand: string | null } | null;
  } | null;
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
  return "Unknown error (check console + Network tab)";
}

function fmtMoney(n?: number | null) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return "—";
  return `$${v.toFixed(2)}`;
}

function fmtKgFromG(g?: number | null) {
  const v = Number(g ?? 0);
  if (!Number.isFinite(v) || v === 0) return "";
  return `${(v / 1000).toFixed(3)}kg`;
}

export default function SupplierSection() {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);

  const [suppliersDb, setSuppliersDb] = useState<SupplierDbRow[]>([]);
  const [supplierProducts, setSupplierProducts] = useState<SupplierProductRow[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsErrorMsg, setProductsErrorMsg] = useState<string | null>(null);
  const [activeModalTab, setActiveModalTab] = useState<"history" | "products">("history");

  // Create supplier
  const [supplierCreateOpen, setSupplierCreateOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [newSupplierNotes, setNewSupplierNotes] = useState("");
  const [supplierCreateLoading, setSupplierCreateLoading] = useState(false);
  const [supplierCreateError, setSupplierCreateError] = useState<string | null>(null);

  // Edit/delete supplier
  const [supplierEditOpen, setSupplierEditOpen] = useState(false);
  const [editSupplierId, setEditSupplierId] = useState<string | null>(null);
  const [editSupplierName, setEditSupplierName] = useState("");
  const [editSupplierPhone, setEditSupplierPhone] = useState("");
  const [editSupplierNotes, setEditSupplierNotes] = useState("");
  const [supplierEditLoading, setSupplierEditLoading] = useState(false);
  const [supplierEditError, setSupplierEditError] = useState<string | null>(null);
  const [supplierDeleteLoading, setSupplierDeleteLoading] = useState(false);
  const [supplierDeleteError, setSupplierDeleteError] = useState<string | null>(null);

  // Variant search + linking
  const [variantSearch, setVariantSearch] = useState("");
  const [variantResults, setVariantResults] = useState<VariantSearchRow[]>([]);
  const [variantSearchLoading, setVariantSearchLoading] = useState(false);
  const [variantSearchError, setVariantSearchError] = useState<string | null>(null);

  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [linkPrimary, setLinkPrimary] = useState(false);
  const [linkSku, setLinkSku] = useState("");
  const [linkDefaultBuy, setLinkDefaultBuy] = useState("");
  const [linkingLoading, setLinkingLoading] = useState(false);
  const [linkingError, setLinkingError] = useState<string | null>(null);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);

  const selectedSupplierId = useMemo(() => {
    if (!selectedSupplier) return null;
    const match = suppliersDb.find((s) => s.name.trim() === selectedSupplier);
    return match?.id ?? null;
  }, [selectedSupplier, suppliersDb]);

  async function loadSuppliersDb() {
    const { data: sdata, error: serror } = await supabase
      .from("suppliers")
      .select("id,name,phone,notes,created_at")
      .order("name", { ascending: true });

    // If the table doesn't exist yet, keep the page working.
    if (!serror) setSuppliersDb(((sdata ?? []) as any) as SupplierDbRow[]);

    return { sdata: ((sdata ?? []) as any) as SupplierDbRow[], serror };
  }

  async function loadSuppliers() {
    // Load canonical suppliers first
    const { sdata } = await loadSuppliersDb();

    // Pull only movement rows that have supplier_name.
    // We compute supplier stats client-side to keep schema simple.
    const { data, error } = await supabase
      .from("inventory_movements")
      .select(
        "id,created_at,type,qty_g,qty_units,cost_total,supplier_name,note,variant:product_variants(id,name,variant_type,pack_size_g,product:products(name,brand))"
      )
      .not("supplier_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) throw error;

    const mv = (data ?? []) as any as MovementRow[];
    setMovements(mv);

    // Only count supplier activity for inbound movements by default
    const inboundTypes = new Set(["restock", "return", "adjustment"]);

    const map = new Map<string, SupplierRow>();
    for (const m of mv) {
      const name = (m.supplier_name ?? "").trim();
      if (!name) continue;

      if (!map.has(name)) {
        map.set(name, {
          supplier_name: name,
          restocks_count: 0,
          total_cost: 0,
          last_restock_at: null,
        });
      }
      const s = map.get(name)!;

      if (inboundTypes.has((m.type ?? "").toLowerCase())) {
        s.restocks_count += 1;
        s.total_cost += Number(m.cost_total ?? 0) || 0;
        if (!s.last_restock_at) s.last_restock_at = m.created_at;
      }
    }

    // Also include suppliers from suppliers table even if they have no movements yet.
    for (const s of sdata) {
      const name = (s.name ?? "").trim();
      if (!name) continue;
      if (!map.has(name)) {
        map.set(name, {
          supplier_name: name,
          restocks_count: 0,
          total_cost: 0,
          last_restock_at: null,
        });
      }
    }

    const arr = Array.from(map.values()).sort((a, b) => {
      const ta = a.last_restock_at ? new Date(a.last_restock_at).getTime() : 0;
      const tb = b.last_restock_at ? new Date(b.last_restock_at).getTime() : 0;
      return tb - ta;
    });

    setRows(arr);
  }

  async function createSupplier() {
    const name = newSupplierName.trim();
    if (!name) {
      setSupplierCreateError("Supplier name is required.");
      return;
    }

    setSupplierCreateLoading(true);
    setSupplierCreateError(null);
    try {
      const { error } = await supabase.from("suppliers").insert({
        name,
        phone: newSupplierPhone.trim() || null,
        notes: newSupplierNotes.trim() || null,
      });
      if (error) throw error;

      await loadSuppliers();

      setSupplierCreateOpen(false);
      setNewSupplierName("");
      setNewSupplierPhone("");
      setNewSupplierNotes("");
    } catch (e: any) {
      console.error("createSupplier error:", e);
      setSupplierCreateError(formatErr(e));
    } finally {
      setSupplierCreateLoading(false);
    }
  }

  function openEditSupplierByName(supplierName: string) {
    const row = suppliersDb.find((s) => s.name.trim() === supplierName.trim());
    setSupplierEditError(null);
    setSupplierDeleteError(null);

    if (!row) {
      // allow editing name even if it doesn't exist (but save will fail due to missing id)
      setEditSupplierId(null);
      setEditSupplierName(supplierName);
      setEditSupplierPhone("");
      setEditSupplierNotes("");
      setSupplierEditError("Supplier not found in suppliers table. Create it first.");
      setSupplierEditOpen(true);
      return;
    }

    setEditSupplierId(row.id);
    setEditSupplierName(row.name ?? "");
    setEditSupplierPhone(row.phone ?? "");
    setEditSupplierNotes(row.notes ?? "");
    setSupplierEditOpen(true);
  }

  async function updateSupplier() {
    const id = editSupplierId;
    const name = editSupplierName.trim();
    if (!id) {
      setSupplierEditError("Missing supplier id.");
      return;
    }
    if (!name) {
      setSupplierEditError("Supplier name is required.");
      return;
    }

    setSupplierEditLoading(true);
    setSupplierEditError(null);
    try {
      const { error } = await supabase
        .from("suppliers")
        .update({
          name,
          phone: editSupplierPhone.trim() || null,
          notes: editSupplierNotes.trim() || null,
        })
        .eq("id", id);

      if (error) throw error;

      await loadSuppliers();

      if (selectedSupplier && selectedSupplierId === id) {
        setSelectedSupplier(name);
      }

      setSupplierEditOpen(false);
    } catch (e: any) {
      console.error("updateSupplier error:", e);
      setSupplierEditError(formatErr(e));
    } finally {
      setSupplierEditLoading(false);
    }
  }

  async function deleteSupplier() {
    const id = editSupplierId;
    if (!id) {
      setSupplierDeleteError("Missing supplier id.");
      return;
    }

    setSupplierDeleteLoading(true);
    setSupplierDeleteError(null);
    try {
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) throw error;

      await loadSuppliers();

      setSupplierEditOpen(false);

      if (selectedSupplierId === id) {
        setSelectedSupplier(null);
        setSupplierProducts([]);
        setProductsErrorMsg(null);
        setActiveModalTab("history");
      }
    } catch (e: any) {
      console.error("deleteSupplier error:", e);
      setSupplierDeleteError(formatErr(e));
    } finally {
      setSupplierDeleteLoading(false);
    }
  }

  async function searchVariants(qtxt: string) {
    const needle = qtxt.trim();
    if (!needle) {
      setVariantResults([]);
      return;
    }

    setVariantSearchLoading(true);
    setVariantSearchError(null);
    try {
      // Simple & reliable: search variant name or sku
      const { data, error } = await supabase
        .from("product_variants")
        .select("id,name,variant_type,pack_size_g,sku,sell_price,is_active,product:products(id,name,brand)")
        .or(`name.ilike.%${needle}%,sku.ilike.%${needle}%`)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      setVariantResults(((data ?? []) as any) as VariantSearchRow[]);
    } catch (e: any) {
      console.error("searchVariants error:", e);
      setVariantResults([]);
      setVariantSearchError(formatErr(e));
    } finally {
      setVariantSearchLoading(false);
    }
  }

  async function linkVariantToSupplier() {
    setLinkingError(null);

    if (!selectedSupplierId) {
      setLinkingError("This supplier is not in the suppliers table yet.");
      return;
    }
    if (!selectedVariantId) {
      setLinkingError("Choose a variant to link.");
      return;
    }

    setLinkingLoading(true);
    try {
      const defaultBuy = linkDefaultBuy.trim() ? Number(linkDefaultBuy) : null;
      if (linkDefaultBuy.trim() && !Number.isFinite(defaultBuy as any)) {
        throw new Error("Default buy price must be a number.");
      }

      const { error } = await supabase.from("supplier_products").upsert(
        {
          supplier_id: selectedSupplierId,
          variant_id: selectedVariantId,
          is_primary: linkPrimary,
          supplier_sku: linkSku.trim() || null,
          default_buy_price: defaultBuy,
          active: true,
        },
        { onConflict: "supplier_id,variant_id" }
      );

      if (error) throw error;

      await loadSupplierProductsBySupplierId(selectedSupplierId);
      setSelectedVariantId(null);
      setLinkPrimary(false);
      setLinkSku("");
      setLinkDefaultBuy("");
      setVariantSearch("");
      setVariantResults([]);
      setVariantSearchError(null);
    } catch (e: any) {
      console.error("linkVariantToSupplier error:", e);
      setLinkingError(formatErr(e));
    } finally {
      setLinkingLoading(false);
    }
  }

  async function unlinkSupplierProduct(spId: string) {
    setUnlinkingId(spId);
    try {
      const { error } = await supabase.from("supplier_products").update({ active: false }).eq("id", spId);
      if (error) throw error;

      if (selectedSupplierId) await loadSupplierProductsBySupplierId(selectedSupplierId);
    } catch (e: any) {
      console.error("unlinkSupplierProduct error:", e);
      setProductsErrorMsg(formatErr(e));
    } finally {
      setUnlinkingId(null);
    }
  }

  async function loadSupplierProductsBySupplierId(supplierId: string) {
    setProductsLoading(true);
    setProductsErrorMsg(null);
    try {
      const { data, error } = await supabase
        .from("supplier_products")
        .select(
          "id,supplier_id,variant_id,is_primary,supplier_sku,default_buy_price,active,created_at,variant:product_variants(id,name,variant_type,pack_size_g,product:products(name,brand))"
        )
        .eq("supplier_id", supplierId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;

      setSupplierProducts(((data ?? []) as any) as SupplierProductRow[]);
    } catch (e: any) {
      console.error("loadSupplierProductsBySupplierId error:", e);
      setSupplierProducts([]);
      setProductsErrorMsg(formatErr(e));
    } finally {
      setProductsLoading(false);
    }
  }

  async function refresh() {
    setLoading(true);
    setErrorMsg(null);
    try {
      await loadSuppliers();
    } catch (e: any) {
      console.error("SupplierSection refresh error:", e);
      setErrorMsg(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      searchVariants(variantSearch);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantSearch]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => r.supplier_name.toLowerCase().includes(needle));
  }, [rows, q]);

  const selectedMovements = useMemo(() => {
    if (!selectedSupplier) return [];
    return movements.filter((m) => (m.supplier_name ?? "").trim() === selectedSupplier);
  }, [movements, selectedSupplier]);

  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Suppliers</h2>
          <p className="mt-2 text-sm text-gray-600">
            Manage suppliers in <b>suppliers</b>, link them to variants via <b>supplier_products</b>, and view history from <b>inventory_movements</b>.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSupplierCreateError(null);
              setSupplierCreateOpen(true);
            }}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
          >
            Add supplier
          </button>

          <button
            type="button"
            onClick={refresh}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
      )}

      <div className="mt-6 grid gap-3 rounded-xl border p-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <label className="text-xs text-gray-600">Search supplier</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            placeholder="e.g. Bakaaro Supplier"
          />
        </div>
        <div className="flex items-end justify-end text-sm text-gray-600">{filtered.length} supplier(s)</div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2">Inbound movements</th>
              <th className="px-3 py-2">Total cost</th>
              <th className="px-3 py-2">Last inbound</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.supplier_name} className="border-t">
                <td className="px-3 py-2 font-medium">{r.supplier_name}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{r.restocks_count}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{fmtMoney(r.total_cost)}</td>
                <td className="px-3 py-2 text-xs text-gray-700">
                  {r.last_restock_at ? new Date(r.last_restock_at).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSupplier(r.supplier_name);
                        setActiveModalTab("history");
                      }}
                      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                    >
                      View history
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSupplier(r.supplier_name);
                        setActiveModalTab("products");

                        const supplierId = suppliersDb.find((s) => s.name.trim() === r.supplier_name)?.id;
                        if (supplierId) {
                          loadSupplierProductsBySupplierId(supplierId);
                        } else {
                          setSupplierProducts([]);
                          setProductsErrorMsg(
                            "This supplier is not in the suppliers table yet. Click Edit to create/standardize it, then link products in supplier_products."
                          );
                        }
                      }}
                      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                    >
                      View products
                    </button>

                    <button
                      type="button"
                      onClick={() => openEditSupplierByName(r.supplier_name)}
                      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                    >
                      Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-sm text-gray-500" colSpan={5}>
                  No suppliers yet. Click <b>"Add supplier"</b> to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedSupplier && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Supplier</div>
                <div className="mt-1 text-xs text-gray-600">{selectedSupplier}</div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveModalTab("history")}
                    className={`rounded-md border px-2 py-1 text-xs ${
                      activeModalTab === "history" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white hover:bg-gray-50"
                    }`}
                  >
                    History
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveModalTab("products");
                      if (selectedSupplierId) loadSupplierProductsBySupplierId(selectedSupplierId);
                      else {
                        setSupplierProducts([]);
                        setProductsErrorMsg(
                          "This supplier is not in the suppliers table yet. Create it in the suppliers table (name must match), then link products in supplier_products."
                        );
                      }
                    }}
                    className={`rounded-md border px-2 py-1 text-xs ${
                      activeModalTab === "products" ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white hover:bg-gray-50"
                    }`}
                  >
                    Products
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedSupplier(null);
                  setSupplierProducts([]);
                  setProductsErrorMsg(null);
                  setActiveModalTab("history");

                  // clear linking/search state
                  setVariantSearch("");
                  setVariantResults([]);
                  setVariantSearchError(null);
                  setSelectedVariantId(null);
                  setLinkingError(null);
                }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            {activeModalTab === "history" && (
              <div className="mt-4 overflow-x-auto rounded-xl border">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-600">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">Variant</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Qty</th>
                      <th className="px-3 py-2">Cost</th>
                      <th className="px-3 py-2">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedMovements.slice(0, 50).map((m) => {
                      const productName = m.variant?.product?.name ?? "";
                      const brand = m.variant?.product?.brand ? ` (${m.variant?.product?.brand})` : "";
                      const variantLabel = m.variant?.name ?? "";
                      const g = m.qty_g == null ? 0 : Number(m.qty_g);
                      const u = m.qty_units == null ? 0 : Number(m.qty_units);
                      const qtyTxt = g ? fmtKgFromG(g) : u ? `${u} units` : "";

                      return (
                        <tr key={m.id} className="border-t">
                          <td className="px-3 py-2 text-xs text-gray-700">{new Date(m.created_at).toLocaleString()}</td>
                          <td className="px-3 py-2 text-xs text-gray-700">
                            {productName}
                            {brand}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-700">{variantLabel}</td>
                          <td className="px-3 py-2 text-xs text-gray-700">{m.type}</td>
                          <td className="px-3 py-2 text-xs text-gray-700">{qtyTxt}</td>
                          <td className="px-3 py-2 text-xs text-gray-700">{fmtMoney(m.cost_total)}</td>
                          <td className="px-3 py-2 text-xs text-gray-700">{m.note ?? ""}</td>
                        </tr>
                      );
                    })}

                    {selectedMovements.length === 0 && (
                      <tr>
                        <td className="px-3 py-6 text-center text-sm text-gray-500" colSpan={7}>
                          No movements found for this supplier.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeModalTab === "products" && (
              <div className="mt-4">
                {productsErrorMsg && (
                  <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{productsErrorMsg}</div>
                )}

                {selectedSupplierId && (
                  <div className="mb-4 rounded-xl border bg-white p-3">
                    <div className="text-sm font-semibold">Link a variant</div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className="text-xs text-gray-600">Search variants (by variant name or SKU)</label>
                        <input
                          value={variantSearch}
                          onChange={(e) => {
                            setVariantSearch(e.target.value);
                            setVariantSearchError(null);
                          }}
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                          placeholder="e.g. Sugar 1kg / PV-001"
                        />
                        {variantSearchLoading && <div className="mt-1 text-xs text-gray-500">Searching…</div>}
                        {variantSearchError && <div className="mt-1 text-xs text-red-700">{variantSearchError}</div>}
                      </div>

                      <div className="sm:col-span-2">
                        <label className="text-xs text-gray-600">Select variant</label>
                        <select
                          value={selectedVariantId ?? ""}
                          onChange={(e) => setSelectedVariantId(e.target.value || null)}
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="">-- choose --</option>
                          {variantResults.map((v) => {
                            const prod = v.product?.name
                              ? `${v.product.name}${v.product.brand ? ` (${v.product.brand})` : ""}`
                              : "";
                            const pack = v.pack_size_g ? ` • ${v.pack_size_g}g` : "";
                            const sku = v.sku ? ` • SKU: ${v.sku}` : "";
                            return (
                              <option key={v.id} value={v.id}>
                                {prod} — {v.name}
                                {pack}
                                {sku}
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs text-gray-600">Supplier SKU (optional)</label>
                        <input
                          value={linkSku}
                          onChange={(e) => setLinkSku(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                          placeholder="e.g. ALI-001"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-gray-600">Default buy price (optional)</label>
                        <input
                          value={linkDefaultBuy}
                          onChange={(e) => setLinkDefaultBuy(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                          placeholder="e.g. 0.75"
                        />
                      </div>

                      <div className="sm:col-span-2 flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={linkPrimary} onChange={(e) => setLinkPrimary(e.target.checked)} />
                          Primary supplier for this variant
                        </label>

                        <button
                          type="button"
                          onClick={linkVariantToSupplier}
                          disabled={linkingLoading}
                          className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-60"
                        >
                          {linkingLoading ? "Linking…" : "Link variant"}
                        </button>
                      </div>

                      {linkingError && <div className="sm:col-span-2 text-sm text-red-700">{linkingError}</div>}
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto rounded-xl border">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-600">
                      <tr>
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2">Variant</th>
                        <th className="px-3 py-2">Primary</th>
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">Default buy</th>
                        <th className="px-3 py-2">Linked</th>
                        <th className="px-3 py-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productsLoading && (
                        <tr>
                          <td className="px-3 py-6 text-sm text-gray-500" colSpan={7}>
                            Loading linked products…
                          </td>
                        </tr>
                      )}

                      {!productsLoading &&
                        supplierProducts.map((sp) => {
                          const productName = sp.variant?.product?.name ?? "";
                          const brand = sp.variant?.product?.brand ? ` (${sp.variant?.product?.brand})` : "";
                          const variantLabel = sp.variant?.name ?? "";

                          return (
                            <tr key={sp.id} className="border-t">
                              <td className="px-3 py-2 text-xs text-gray-700">
                                {productName}
                                {brand}
                              </td>
                              <td className="px-3 py-2 text-xs text-gray-700">{variantLabel}</td>
                              <td className="px-3 py-2 text-xs text-gray-700">{sp.is_primary ? "Yes" : "No"}</td>
                              <td className="px-3 py-2 text-xs text-gray-700">{sp.supplier_sku ?? "—"}</td>
                              <td className="px-3 py-2 text-xs text-gray-700">{fmtMoney(sp.default_buy_price)}</td>
                              <td className="px-3 py-2 text-xs text-gray-700">{new Date(sp.created_at).toLocaleString()}</td>
                              <td className="px-3 py-2 text-xs text-gray-700">
                                <button
                                  type="button"
                                  onClick={() => unlinkSupplierProduct(sp.id)}
                                  disabled={unlinkingId === sp.id}
                                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-60"
                                >
                                  {unlinkingId === sp.id ? "Unlinking…" : "Unlink"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}

                      {!productsLoading && supplierProducts.length === 0 && !productsErrorMsg && (
                        <tr>
                          <td className="px-3 py-6 text-center text-sm text-gray-500" colSpan={7}>
                            No linked products yet. Link variants above.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-3 text-xs text-gray-500">Tip: Use this to set preferred suppliers per variant and default buy prices.</div>
              </div>
            )}

            {activeModalTab === "history" && (
              <div className="mt-3 text-xs text-gray-500">
                Tip: When you restock from the same supplier tomorrow at a different price, the movement cost will update your weighted average cost.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create supplier modal */}
      {supplierCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Add supplier</div>
                <div className="mt-1 text-xs text-gray-600">Creates a row in <b>suppliers</b>.</div>
              </div>
              <button
                type="button"
                onClick={() => setSupplierCreateOpen(false)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            {supplierCreateError && (
              <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{supplierCreateError}</div>
            )}

            <div className="mt-4 grid gap-3">
              <div>
                <label className="text-xs text-gray-600">Supplier name *</label>
                <input
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  placeholder="e.g. Ali Traders"
                />
                <div className="mt-1 text-xs text-gray-500">Tip: match the name you type in inventory movements (for history view).</div>
              </div>

              <div>
                <label className="text-xs text-gray-600">Phone (optional)</label>
                <input
                  value={newSupplierPhone}
                  onChange={(e) => setNewSupplierPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  placeholder="e.g. 0612xxxxxxx"
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">Notes (optional)</label>
                <textarea
                  value={newSupplierNotes}
                  onChange={(e) => setNewSupplierNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  rows={3}
                  placeholder="Anything important about this supplier…"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSupplierCreateOpen(false)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createSupplier}
                  disabled={supplierCreateLoading}
                  className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-60"
                >
                  {supplierCreateLoading ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit supplier modal */}
      {supplierEditOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Edit supplier</div>
                <div className="mt-1 text-xs text-gray-600">Update or delete this supplier.</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSupplierEditOpen(false);
                  setSupplierEditError(null);
                  setSupplierDeleteError(null);
                }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            {(supplierEditError || supplierDeleteError) && (
              <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{supplierEditError ?? supplierDeleteError}</div>
            )}

            <div className="mt-4 grid gap-3">
              <div>
                <label className="text-xs text-gray-600">Supplier name *</label>
                <input
                  value={editSupplierName}
                  onChange={(e) => setEditSupplierName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  placeholder="e.g. Ali Traders"
                />
                <div className="mt-1 text-xs text-gray-500">History uses inventory_movements.supplier_name, so keep names consistent.</div>
              </div>

              <div>
                <label className="text-xs text-gray-600">Phone (optional)</label>
                <input
                  value={editSupplierPhone}
                  onChange={(e) => setEditSupplierPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">Notes (optional)</label>
                <textarea
                  value={editSupplierNotes}
                  onChange={(e) => setEditSupplierNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                  rows={3}
                />
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!editSupplierId) {
                      setSupplierDeleteError("Missing supplier id.");
                      return;
                    }
                    const ok = window.confirm("Delete this supplier? Linked supplier_products will also be removed.");
                    if (ok) deleteSupplier();
                  }}
                  disabled={supplierDeleteLoading}
                  className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                  {supplierDeleteLoading ? "Deleting…" : "Delete"}
                </button>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSupplierEditOpen(false)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={updateSupplier}
                    disabled={supplierEditLoading}
                    className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-60"
                  >
                    {supplierEditLoading ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}