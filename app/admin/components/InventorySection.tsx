
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Variant = {
  id: string;
  name: string;
  variant_type: string; // "unit" | "weight" etc
  is_active: boolean;
  product?: { name: string } | null;
};

type InventoryRow = {
  variant_id: string;
  qty_g: number | null;
  qty_units: number | null;
  reorder_level_g: number | null;
  reorder_level_units: number | null;
  avg_cost_per_g: number | null;
  avg_cost_per_unit: number | null;
  updated_at: string | null;
  variant?: Variant | null;
};

function toInt(input: string) {
  const n = Number(input);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function kgToG(inputKg: string) {
  const n = Number(inputKg);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 1000));
}

function gToKg(g?: number | null) {
  const n = Number(g ?? 0);
  if (!Number.isFinite(n)) return "0.000";
  return (n / 1000).toFixed(3);
}

function fmtMoney(n?: number | null) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return "—";
  // Keep it simple: USD display. You can add currency later.
  return `$${v.toFixed(2)}`;
}

function costPerKg(avgCostPerG?: number | null) {
  const v = Number(avgCostPerG ?? 0);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v * 1000;
}

function stockValueWeight(qtyG?: number | null, avgCostPerG?: number | null) {
  const q = Number(qtyG ?? 0);
  const c = Number(avgCostPerG ?? 0);
  if (!Number.isFinite(q) || !Number.isFinite(c) || q <= 0 || c <= 0) return null;
  return q * c;
}

function stockValueUnit(qtyUnits?: number | null, avgCostPerUnit?: number | null) {
  const q = Number(qtyUnits ?? 0);
  const c = Number(avgCostPerUnit ?? 0);
  if (!Number.isFinite(q) || !Number.isFinite(c) || q <= 0 || c <= 0) return null;
  return q * c;
}

export default function InventorySection() {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [variants, setVariants] = useState<Variant[]>([]);
  const [rows, setRows] = useState<InventoryRow[]>([]);

  // form
  const [variantId, setVariantId] = useState("");
  const [qtyKg, setQtyKg] = useState("0.000");
  const [qtyUnits, setQtyUnits] = useState("0");
  const [reorderKg, setReorderKg] = useState("0.000");
  const [reorderUnits, setReorderUnits] = useState("0");

  const selectedVariant = useMemo(
    () => variants.find((v) => v.id === variantId) ?? null,
    [variants, variantId]
  );

  function isLow(v: Variant | null | undefined, r: InventoryRow) {
    if (!v) return false;
    const vt = (v.variant_type || "").toLowerCase();
    if (vt === "weight") {
      const q = r.qty_g ?? 0;
      const rl = r.reorder_level_g ?? 0;
      return q <= rl && rl > 0;
    }
    // default: unit
    const q = r.qty_units ?? 0;
    const rl = r.reorder_level_units ?? 0;
    return q <= rl && rl > 0;
  }

  async function loadVariants() {
    const { data, error } = await supabase
      .from("product_variants")
      .select("id,name,variant_type,is_active,product:products(name)")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;

    setVariants((data ?? []) as any);
  }

  async function loadInventory() {
    // Join inventory -> product_variants (explicit FK name not required if relationship exists; if it fails, user will see error)
    const { data, error } = await supabase
      .from("inventory")
      .select(
        "variant_id,qty_g,qty_units,reorder_level_g,reorder_level_units,avg_cost_per_g,avg_cost_per_unit,updated_at,variant:product_variants(id,name,variant_type,is_active,product:products(name))"
      );

    if (error) throw error;

    const mapped = (data ?? []).map((r: any) => ({
      variant_id: r.variant_id,
      qty_g: r.qty_g ?? 0,
      qty_units: r.qty_units ?? 0,
      reorder_level_g: r.reorder_level_g ?? 0,
      reorder_level_units: r.reorder_level_units ?? 0,
      avg_cost_per_g: r.avg_cost_per_g ?? null,
      avg_cost_per_unit: r.avg_cost_per_unit ?? null,
      updated_at: r.updated_at ?? null,
      variant: r.variant ?? null,
    })) as InventoryRow[];

    setRows(mapped);
  }

  async function refreshAll() {
    setErrorMsg(null);
    setLoading(true);
    try {
      await Promise.all([loadVariants(), loadInventory()]);
    } catch (e: any) {
      console.error("InventorySection refreshAll error:", e);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When a variant is selected, prefill from existing inventory row if present
  useEffect(() => {
    if (!variantId) return;

    const existing = rows.find((r) => r.variant_id === variantId);
    if (!existing) {
      setQtyKg("0.000");
      setQtyUnits("0");
      setReorderKg("0.000");
      setReorderUnits("0");
      return;
    }

    setQtyKg(gToKg(existing.qty_g ?? 0));
    setQtyUnits(String(existing.qty_units ?? 0));
    setReorderKg(gToKg(existing.reorder_level_g ?? 0));
    setReorderUnits(String(existing.reorder_level_units ?? 0));
  }, [variantId, rows]);

  async function upsertInventory() {
    setErrorMsg(null);

    if (!variantId) {
      setErrorMsg("Please select a variant first.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        variant_id: variantId,
        qty_g: kgToG(qtyKg),
        qty_units: toInt(qtyUnits),
        reorder_level_g: kgToG(reorderKg),
        reorder_level_units: toInt(reorderUnits),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("inventory")
        .upsert(payload, { onConflict: "variant_id" });

      if (error) throw error;

      await loadInventory();
    } catch (e: any) {
      console.error("upsertInventory error:", e);
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  const viewRows = useMemo(() => {
    const withComputed = rows.map((r) => {
      const low = isLow(r.variant ?? null, r);
      const name = r.variant?.name ?? "(unknown variant)";
      return { ...r, _low: low, _name: name };
    });

    withComputed.sort((a: any, b: any) => {
      if (a._low !== b._low) return a._low ? -1 : 1;
      return String(a._name).localeCompare(String(b._name));
    });

    return withComputed as any[];
  }, [rows]);

  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Inventory</h2>
          <p className="mt-2 text-sm text-gray-600">
            Simple stock levels per variant (grams for weight items, units for unit items).
          </p>
        </div>

        <button
          type="button"
          onClick={refreshAll}
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

      {/* Upsert form */}
      <div className="mt-6 rounded-xl border p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="text-xs text-gray-600">Variant</label>
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="">Select variant…</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {(v.product?.name ? `${v.product.name} — ` : "")}{v.name} ({v.variant_type})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {selectedVariant
                ? `Selected: ${selectedVariant.name} • type: ${selectedVariant.variant_type}`
                : "Pick a variant to set stock."}
            </p>
          </div>

          <div>
            <label className="text-xs text-gray-600">Qty (kg)</label>
            <input
              value={qtyKg}
              onChange={(e) => setQtyKg(e.target.value)}
              inputMode="decimal"
              step="0.001"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              placeholder="e.g. 50.000"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Qty (units)</label>
            <input
              value={qtyUnits}
              onChange={(e) => setQtyUnits(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              placeholder="e.g. 120"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Reorder level (kg)</label>
            <input
              value={reorderKg}
              onChange={(e) => setReorderKg(e.target.value)}
              inputMode="decimal"
              step="0.001"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              placeholder="e.g. 5.000"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Reorder level (units)</label>
            <input
              value={reorderUnits}
              onChange={(e) => setReorderUnits(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              placeholder="e.g. 10"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={upsertInventory}
            disabled={loading}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {loading ? "Saving..." : "Save / Update"}
          </button>
          <div className="text-xs text-gray-500">{loading ? "Talking to DB…" : "Ready"}</div>
        </div>

        <div className="mt-3 text-xs text-gray-500">
          Tip: For weight items, use <b>kilograms</b> (up to 3 decimals). Stored internally as grams. For unit items, use <b>units</b>.
        </div>
      </div>

      {/* Inventory list */}
      <div className="mt-6">
        <div className="text-sm font-medium">Current stock</div>

        <div className="mt-3 overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2">Variant</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Qty kg</th>
                <th className="px-3 py-2">Qty units</th>
                <th className="px-3 py-2">Reorder kg</th>
                <th className="px-3 py-2">Reorder units</th>
                <th className="px-3 py-2">Avg cost/kg</th>
                <th className="px-3 py-2">Avg cost/unit</th>
                <th className="px-3 py-2">Stock value</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {viewRows.map((r: any) => {
                const v = r.variant as Variant | null;
                const low = isLow(v, r);
                return (
                  <tr key={r.variant_id} className="border-t">
                    <td className="px-3 py-2 font-medium">
                      <div>{v?.product?.name ?? ""}</div>
                      <div>{v?.name ?? r.variant_id}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{v?.variant_type ?? "—"}</td>
                    <td className="px-3 py-2">{gToKg(r.qty_g)}</td>
                    <td className="px-3 py-2">{r.qty_units ?? 0}</td>
                    <td className="px-3 py-2">{gToKg(r.reorder_level_g)}</td>
                    <td className="px-3 py-2">{r.reorder_level_units ?? 0}</td>
                    <td className="px-3 py-2">
                      {(() => {
                        const vkg = costPerKg(r.avg_cost_per_g);
                        return vkg ? fmtMoney(vkg) : "—";
                      })()}
                    </td>
                    <td className="px-3 py-2">{r.avg_cost_per_unit ? fmtMoney(r.avg_cost_per_unit) : "—"}</td>
                    <td className="px-3 py-2">
                      {(() => {
                        const vt = (v?.variant_type || "").toLowerCase();
                        if (vt === "weight") return fmtMoney(stockValueWeight(r.qty_g, r.avg_cost_per_g));
                        return fmtMoney(stockValueUnit(r.qty_units, r.avg_cost_per_unit));
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      {low ? (
                        <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">
                          LOW
                        </span>
                      ) : (
                        <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!loading && viewRows.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-sm text-gray-500" colSpan={10}>
                    No inventory rows yet. Select a variant above and save stock.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-gray-500">
          Low-stock rule: for <b>weight</b> variants we compare <b>qty_g</b> to <b>reorder_level_g</b>; otherwise we compare
          <b> qty_units</b> to <b>reorder_level_units</b>.<br />
          Avg costs are updated automatically when you do <b>restock/return/adjustment</b> movements with a <b>cost total</b>.
        </div>
      </div>
    </div>
  );
}
