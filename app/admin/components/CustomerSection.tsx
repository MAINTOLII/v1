// --- REPLACEMENT: see instructions ---
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface Customer {
  id: string;
  name: string | null;
  phone: string;
  created_at: string;
}

type MovementRow = {
  id: string;
  variant_id: string;
  type: string;
  qty_g: number | null;
  qty_units: number | null;
  note: string | null;
  created_at: string;
};

type VariantRow = {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  product?: {
    id: string;
    name: string;
    brand: string | null;
  } | null;
};

type SaleGroup = {
  receipt: string;
  created_at: string;
  customer_note: string;
  items: Array<{
    movement_id: string;
    variant_id: string;
    qty_g: number | null;
    qty_units: number | null;
    created_at: string;
  }>;
};

function extractReceipt(note: string | null) {
  if (!note) return "";
  const m = note.match(/\bPOS-[A-Za-z0-9-]+\b/);
  return m?.[0] ?? "";
}

function extractCustomerLine(note: string | null) {
  if (!note) return "";
  // e.g. "Customer: Ahmed (+2526...) | POS-... | Note: ..."
  const parts = note.split("|").map((s) => s.trim());
  const c = parts.find((p) => p.toLowerCase().startsWith("customer:"));
  return c ?? "";
}

async function hydrateProducts(rows: VariantRow[]): Promise<VariantRow[]> {
  const missingIds = Array.from(
    new Set(
      rows
        .filter((r) => !r.product && r.product_id)
        .map((r) => r.product_id)
    )
  );
  if (missingIds.length === 0) return rows;

  const { data, error } = await supabase
    .from("products")
    .select("id,name,brand")
    .in("id", missingIds);

  if (error) {
    console.warn("hydrateProducts: products fetch failed:", error);
    return rows;
  }

  const map = new Map<string, any>((data ?? []).map((p: any) => [p.id, p]));
  return rows.map((r) => (r.product ? r : { ...r, product: map.get(r.product_id) ?? null }));
}

function variantLabel(v: VariantRow | null | undefined) {
  if (!v) return "—";
  const p = v.product?.name ?? "(Unknown product)";
  const b = v.product?.brand ? ` (${v.product?.brand})` : "";
  const sku = v.sku ? ` • ${v.sku}` : "";
  const vn = v.name ?? "";
  return `${p}${b} — ${vn}${sku}`.trim();
}

export default function CustomerSection() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [pageSize, setPageSize] = useState(50);

  // create
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  // edit/delete
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");

  // selection + sales
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [saleGroups, setSaleGroups] = useState<SaleGroup[]>([]);
  const [variantMap, setVariantMap] = useState<Record<string, VariantRow>>({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const salesReqKey = useRef(0);

  const showList = q.trim().length >= 2;

  async function loadCustomers() {
    const { data, error } = await supabase
      .from("customers")
      .select("id,name,phone,created_at")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) {
      setError(error.message);
      return;
    }
    setCustomers((data ?? []) as Customer[]);
  }

  useEffect(() => {
    loadCustomers();
  }, []);

  const filteredAll = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((c) => `${c.name ?? ""} ${c.phone}`.toLowerCase().includes(needle));
  }, [customers, q]);

  const filtered = useMemo(() => {
    return filteredAll.slice(0, pageSize);
  }, [filteredAll, pageSize]);

  // If search narrows to 1 customer, auto-select and show sales
  useEffect(() => {
    if (q.trim().length === 0) return;
    if (filteredAll.length === 1) {
      setSelectedCustomerId(filteredAll[0].id);
    }
  }, [q, filteredAll]);

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId) ?? null;
  }, [customers, selectedCustomerId]);

  async function addCustomer() {
    setError(null);
    if (!phone.trim()) {
      setError("Phone number is required");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from("customers")
        .upsert({ name: name.trim() || null, phone: phone.trim() }, { onConflict: "phone" });

      if (error) throw error;

      setName("");
      setPhone("");
      await loadCustomers();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function startEdit(c: Customer) {
    setEditingId(c.id);
    setEditName(c.name ?? "");
    setEditPhone(c.phone);
  }

  async function saveEdit() {
    if (!editingId) return;
    setError(null);
    if (!editPhone.trim()) {
      setError("Phone number is required");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from("customers")
        .update({ name: editName.trim() || null, phone: editPhone.trim() })
        .eq("id", editingId);
      if (error) throw error;

      setEditingId(null);
      setEditName("");
      setEditPhone("");
      await loadCustomers();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteCustomer(id: string) {
    setError(null);
    const ok = window.confirm("Delete this customer? This will not delete sales history.");
    if (!ok) return;

    setLoading(true);
    try {
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;

      if (selectedCustomerId === id) {
        setSelectedCustomerId(null);
        setSaleGroups([]);
        setVariantMap({});
      }

      await loadCustomers();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadSalesForCustomer(c: Customer) {
    setSalesError(null);
    setSalesLoading(true);
    const req = ++salesReqKey.current;

    try {
      const phoneNeedle = c.phone.trim();
      if (!phoneNeedle) {
        setSaleGroups([]);
        setVariantMap({});
        return;
      }

      const { data, error } = await supabase
        .from("inventory_movements")
        .select("id,variant_id,type,qty_g,qty_units,note,created_at")
        .eq("type", "manual_out")
        .ilike("note", `%${phoneNeedle}%`)
        .order("created_at", { ascending: false })
        .limit(500);

      if (req !== salesReqKey.current) return; // stale

      if (error) throw error;

      const rows = (data ?? []) as MovementRow[];
      // group by receipt; fallback to movement id if missing receipt
      const map = new Map<string, SaleGroup>();
      for (const r of rows) {
        const receipt = extractReceipt(r.note) || `NO-RECEIPT-${r.id}`;
        const existing = map.get(receipt);
        if (!existing) {
          map.set(receipt, {
            receipt,
            created_at: r.created_at,
            customer_note: extractCustomerLine(r.note),
            items: [
              {
                movement_id: r.id,
                variant_id: r.variant_id,
                qty_g: r.qty_g,
                qty_units: r.qty_units,
                created_at: r.created_at,
              },
            ],
          });
        } else {
          existing.items.push({
            movement_id: r.id,
            variant_id: r.variant_id,
            qty_g: r.qty_g,
            qty_units: r.qty_units,
            created_at: r.created_at,
          });
          // keep most recent timestamp as group created_at
          if (new Date(r.created_at).getTime() > new Date(existing.created_at).getTime()) {
            existing.created_at = r.created_at;
          }
        }
      }

      const groups = Array.from(map.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      // Fetch variants and hydrate products for labels
      const variantIds = Array.from(
        new Set(groups.flatMap((g) => g.items.map((i) => i.variant_id)).filter(Boolean))
      );

      let vMap: Record<string, VariantRow> = {};
      if (variantIds.length > 0) {
        const { data: vdata, error: verr } = await supabase
          .from("product_variants")
          .select("id,product_id,name,sku")
          .in("id", variantIds)
          .limit(1000);

        if (!verr) {
          const hydrated = await hydrateProducts(((vdata ?? []) as any) as VariantRow[]);
          vMap = Object.fromEntries(hydrated.map((v) => [v.id, v]));
        }
      }

      if (req !== salesReqKey.current) return; // stale

      setVariantMap(vMap);
      setSaleGroups(groups);
    } catch (e: any) {
      if (req !== salesReqKey.current) return;
      setSalesError(e?.message ?? String(e));
      setSaleGroups([]);
      setVariantMap({});
    } finally {
      if (req === salesReqKey.current) setSalesLoading(false);
    }
  }

  useEffect(() => {
    if (selectedCustomer) {
      loadSalesForCustomer(selectedCustomer);
    } else {
      setSaleGroups([]);
      setVariantMap({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomerId]);

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h2 className="text-lg font-semibold">Customers</h2>

        <button
          onClick={() => {
            setPageSize(50);
            loadCustomers();
          }}
          className="rounded border px-3 py-2 text-sm"
          type="button"
        >
          Refresh
        </button>
      </div>

      {/* Create */}
      <div className="mb-4 grid gap-2 md:grid-cols-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Customer name"
          className="rounded border px-3 py-2 text-sm"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone number"
          className="rounded border px-3 py-2 text-sm"
        />
        <button
          onClick={addCustomer}
          disabled={loading}
          className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Add / Update
        </button>
      </div>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      {/* Search */}
      <div className="mb-3 grid gap-2 md:grid-cols-3">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPageSize(50);
          }}
          placeholder="Search customers (type 2+ chars)"
          className="w-full rounded border px-3 py-2 text-sm md:col-span-2"
        />
        <div className="text-xs text-gray-500 md:text-right">
          {showList ? (
            <>Showing {Math.min(filtered.length, filteredAll.length)} of {filteredAll.length}</>
          ) : (
            <>Type 2+ characters to show results</>
          )}
        </div>
      </div>

      {/* List + Details */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {/* Customers list */}
        <div className="rounded border">
          {!showList && !selectedCustomer ? (
            <div className="p-4 text-sm text-gray-500">
              Search for a customer to show the list. Tip: you can search by phone.
            </div>
          ) : null}

          {showList ? (
            <>
              <div className="max-h-[300px] overflow-auto sm:max-h-[420px]">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Phone</th>
                      <th className="px-3 py-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => {
                      const isSelected = c.id === selectedCustomerId;
                      const isEditing = c.id === editingId;

                      return (
                        <tr
                          key={c.id}
                          className={`border-t ${isSelected ? "bg-blue-50" : ""}`}
                        >
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full rounded border px-2 py-1 text-sm"
                                placeholder="Name"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedCustomerId(c.id)}
                                className="text-left font-medium text-gray-900 hover:underline py-1"
                              >
                                {c.name ?? "—"}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <input
                                value={editPhone}
                                onChange={(e) => setEditPhone(e.target.value)}
                                className="w-full rounded border px-2 py-1 text-sm"
                                placeholder="Phone"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedCustomerId(c.id)}
                                className="text-left text-gray-800 hover:underline py-1"
                              >
                                {c.phone}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={saveEdit}
                                    disabled={loading}
                                    className="rounded border px-2 py-1 text-xs sm:text-sm hover:bg-gray-50 disabled:opacity-50"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingId(null);
                                      setEditName("");
                                      setEditPhone("");
                                    }}
                                    className="rounded border px-2 py-1 text-xs sm:text-sm hover:bg-gray-50"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedCustomerId(c.id);
                                      loadSalesForCustomer(c);
                                    }}
                                    className="rounded border px-2 py-1 text-xs sm:text-sm hover:bg-gray-50"
                                  >
                                    Sales
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startEdit(c)}
                                    className="rounded border px-2 py-1 text-xs sm:text-sm hover:bg-gray-50"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteCustomer(c.id)}
                                    className="rounded border px-2 py-1 text-xs sm:text-sm text-red-600 hover:bg-gray-50"
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {filteredAll.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-gray-500">
                          No customers
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {filteredAll.length > filtered.length && (
                <div className="border-t p-3">
                  <button
                    type="button"
                    onClick={() => setPageSize((s) => s + 50)}
                    className="w-full rounded border px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    Show more
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Customer sales */}
        <div className="rounded border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Sales</div>
              <div className="text-xs text-gray-500">
                {selectedCustomer ? (
                  <>
                    {selectedCustomer.name ?? "—"} • {selectedCustomer.phone}
                  </>
                ) : (
                  "Select a customer to view sales"
                )}
              </div>
            </div>

            {selectedCustomer && (
              <button
                type="button"
                onClick={() => loadSalesForCustomer(selectedCustomer)}
                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
              >
                Refresh
              </button>
            )}
          </div>

          {salesError && <div className="mb-2 text-sm text-red-600">{salesError}</div>}

          {!selectedCustomer && (
            <div className="py-6 text-center text-sm text-gray-500">No customer selected</div>
          )}

          {selectedCustomer && salesLoading && (
            <div className="py-6 text-center text-sm text-gray-500">Loading sales…</div>
          )}

          {selectedCustomer && !salesLoading && saleGroups.length === 0 && (
            <div className="py-6 text-center text-sm text-gray-500">No sales found for this customer</div>
          )}

          {selectedCustomer && !salesLoading && saleGroups.length > 0 && (
            <div className="max-h-[320px] overflow-auto sm:max-h-[420px]">
              <div className="space-y-3">
                {saleGroups.map((g) => (
                  <div key={g.receipt} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold">{g.receipt}</div>
                        <div className="text-xs text-gray-500">{new Date(g.created_at).toLocaleString()}</div>
                        {g.customer_note && (
                          <div className="mt-1 text-xs text-gray-600">{g.customer_note}</div>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{g.items.length} item(s)</div>
                    </div>

                    <div className="mt-2 space-y-1">
                      {g.items.map((it) => {
                        const v = variantMap[it.variant_id];
                        const qty =
                          it.qty_g != null && it.qty_g !== 0
                            ? `${(Number(it.qty_g) / 1000).toFixed(3)} kg`
                            : it.qty_units != null
                              ? `${it.qty_units} unit(s)`
                              : "—";

                        return (
                          <div key={it.movement_id} className="flex items-start justify-between gap-3 text-sm">
                            <div className="min-w-0 flex-1">
                              <div className="truncate">{variantLabel(v)}</div>
                            </div>
                            <div className="whitespace-nowrap text-gray-700">{qty}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}