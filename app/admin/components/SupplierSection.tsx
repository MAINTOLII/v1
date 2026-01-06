

"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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
  qty_g: number | null;
  qty_units: number | null;
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

  const [q, setQ] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState<string | null>(null);

  async function loadSuppliers() {
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

    const arr = Array.from(map.values()).sort((a, b) => {
      // newest first
      const ta = a.last_restock_at ? new Date(a.last_restock_at).getTime() : 0;
      const tb = b.last_restock_at ? new Date(b.last_restock_at).getTime() : 0;
      return tb - ta;
    });

    setRows(arr);
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
            Lightweight view based on the <b>supplier name you enter in Movements</b>. No supplier dashboard/table needed yet.
          </p>
        </div>

        <button
          type="button"
          onClick={refresh}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
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
                  <button
                    type="button"
                    onClick={() => setSelectedSupplier(r.supplier_name)}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    View history
                  </button>
                </td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-sm text-gray-500" colSpan={5}>
                  No suppliers yet. Add a supplier name when you do a <b>restock</b> movement.
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
                <div className="text-sm font-semibold">Supplier history</div>
                <div className="mt-1 text-xs text-gray-600">{selectedSupplier}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSupplier(null)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>

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
                    const qtyTxt = m.qty_g && m.qty_g !== 0 ? fmtKgFromG(m.qty_g) : m.qty_units ? `${m.qty_units} units` : "";

                    return (
                      <tr key={m.id} className="border-t">
                        <td className="px-3 py-2 text-xs text-gray-700">{new Date(m.created_at).toLocaleString()}</td>
                        <td className="px-3 py-2 text-xs text-gray-700">{productName}{brand}</td>
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

            <div className="mt-3 text-xs text-gray-500">
              Tip: When you restock from the same supplier tomorrow at a different price, the movement cost will update your weighted average cost.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}