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

type MovementRow = {
  id: string;
  variant_id: string;
  type: string;
  qty_g: number | null;
  qty_units: number | null;
  note: string | null;
  cost_total: number | null;
  supplier_name: string | null;
  created_at: string;
  variant?: { id: string; name: string; variant_type: string; product?: { name: string } | null } | null;
};

function toInt(input: string) {
  const n = Number(input);
  if (!Number.isFinite(n)) return 0;
  // allow negative for adjustments
  return Math.trunc(n);
}

function formatErr(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  if (e?.error_description) return e.error_description;

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

  return "Unknown error (check console + Network tab)";
}

function kgToG(inputKg: string) {
  const n = Number(inputKg);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000); // 3 d.p -> grams
}

function gToKg(g?: number | null) {
  if (!g) return "0.000";
  return (g / 1000).toFixed(3);
}

export default function MovementsSection() {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [variants, setVariants] = useState<Variant[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);

  // form
  const [variantId, setVariantId] = useState("");
  const [type, setType] = useState<"restock" | "manual_out" | "return" | "adjustment">("restock");
  const [qtyKg, setQtyKg] = useState("0.000");
  const [qtyUnits, setQtyUnits] = useState("0");
  const [note, setNote] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [costTotal, setCostTotal] = useState("");

  const selectedVariant = useMemo(
    () => variants.find((v) => v.id === variantId) ?? null,
    [variants, variantId]
  );

  async function loadVariants() {
    const { data, error } = await supabase
      .from("product_variants")
      .select("id,name,variant_type,is_active,product:products(name)")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) throw error;
    setVariants((data ?? []) as any);
  }

  async function loadMovements() {
    const { data, error } = await supabase
      .from("inventory_movements")
      .select(
        "id,variant_id,type,qty_g,qty_units,note,cost_total,supplier_name,created_at,variant:product_variants(id,name,variant_type,product:products(name))"
      )
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const mapped = (data ?? []).map((r: any) => ({
      id: r.id,
      variant_id: r.variant_id,
      type: r.type,
      qty_g: r.qty_g ?? 0,
      qty_units: r.qty_units ?? 0,
      note: r.note ?? null,
      cost_total: r.cost_total ?? null,
      supplier_name: r.supplier_name ?? null,
      created_at: r.created_at,
      variant: r.variant ?? null,
    })) as MovementRow[];

    setMovements(mapped);
  }

  async function refreshAll() {
    setErrorMsg(null);
    setLoading(true);
    try {
      await Promise.all([loadVariants(), loadMovements()]);
    } catch (e: any) {
      console.error("MovementsSection refreshAll error:", e);
      setErrorMsg(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function computeDelta() {
    // UI inputs are always entered as positive numbers for restock/manual_out/return,
    // but for adjustment we allow negative.
    const g = kgToG(qtyKg);
    const u = toInt(qtyUnits);

    if (type === "restock" || type === "return") {
      return { dg: Math.abs(g), du: Math.abs(u) };
    }

    if (type === "manual_out") {
      return { dg: -Math.abs(g), du: -Math.abs(u) };
    }

    // adjustment: allow +/-
    return { dg: g, du: u };
  }

  async function applyMovement() {
    setErrorMsg(null);

    if (!variantId) {
      setErrorMsg("Please select a variant first.");
      return;
    }

    // Basic guard: don’t allow both zero
    const gIn = kgToG(qtyKg);
    const uIn = toInt(qtyUnits);
    if (gIn === 0 && uIn === 0) {
      setErrorMsg("Enter a quantity in kilograms or units.");
      return;
    }

    setLoading(true);
    try {
      const { dg, du } = computeDelta();

      // Only store cost when stock is increasing and user provided cost
      const rawCost = costTotal.trim();
      const costVal = rawCost !== "" ? Number(rawCost) : null;
      const hasPositiveAdd = (dg ?? 0) > 0 || (du ?? 0) > 0;
      const shouldSendCost =
        hasPositiveAdd && (type === "restock" || type === "return" || type === "adjustment") && costVal !== null;

      const noteClean = note.trim();
      const supplierClean = supplierName.trim();

      const { error: rpcErr } = await supabase.rpc("apply_inventory_movement", {
        p_variant_id: variantId,
        p_type: type,
        p_qty_g: dg,
        p_qty_units: du,
        p_cost_total: shouldSendCost ? costVal : null,
        p_supplier_name: supplierClean || null,
        p_note: noteClean || null,
      });

      if (rpcErr) throw rpcErr;

      await loadMovements();

      // reset inputs
      setQtyKg("0.000");
      setQtyUnits("0");
      setNote("");
      setSupplierName("");
      setCostTotal("");
    } catch (e: any) {
      console.error("applyMovement error:", e);
      setErrorMsg(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="text-gray-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Stock Movements</h2>
          <p className="mt-2 text-sm text-gray-600">
            Log restocks, sales, or adjustments. This updates inventory totals and records a movement.
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

      {/* Movement form */}
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
                : "Pick a variant first."}
            </p>
          </div>

          <div>
            <label className="text-xs text-gray-600">Movement type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="restock">Restock (+)</option>
              <option value="manual_out">Manual Out / Sale (−)</option>
              <option value="return">Return (+)</option>
              <option value="adjustment">Adjustment (+/−)</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Restock and Sale treat inputs as positive. Adjustment can be negative.
            </p>
          </div>

          <div>
            <label className="text-xs text-gray-600">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              placeholder='e.g. "Supplier delivery", "Damaged", "POS sale"'
            />
          </div>

          {(type === "restock" || type === "return") && (
            <>
              <div>
                <label className="text-xs text-gray-600">Supplier (optional)</label>
                <input
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  placeholder='e.g. "Bakaaro Supplier"'
                />
              </div>

              <div>
                <label className="text-xs text-gray-600">Cost total (optional)</label>
                <input
                  value={costTotal}
                  onChange={(e) => setCostTotal(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  placeholder="e.g. 14.5"
                />
                <p className="mt-1 text-xs text-gray-500">Enter what you paid for this restock batch.</p>
              </div>
            </>
          )}

          <div>
            <label className="text-xs text-gray-600">Qty (kg)</label>
            <input
              value={qtyKg}
              onChange={(e) => setQtyKg(e.target.value)}
              inputMode="decimal"
              step="0.001"
              placeholder="e.g. 1.250"
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            />
          </div>

          <div>
            <label className="text-xs text-gray-600">Qty (units)</label>
            <input
              value={qtyUnits}
              onChange={(e) => setQtyUnits(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              placeholder="e.g. 24"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={applyMovement}
            disabled={loading}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {loading ? "Saving..." : "Save Movement"}
          </button>
          <div className="text-xs text-gray-500">{loading ? "Talking to DB…" : "Ready"}</div>
        </div>

        <div className="mt-3 text-xs text-gray-500">
          Tip: For weight items use <b>kilograms</b> (3 decimal places). Stored internally as grams. For unit items use <b>units</b>.
        </div>
      </div>

      {/* Recent movements */}
      <div className="mt-6">
        <div className="text-sm font-medium">Recent movements</div>

        <div className="mt-3 overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Variant</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Δ kg</th>
                <th className="px-3 py-2">Δ units</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Cost</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {new Date(m.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <div>{m.variant?.product?.name ?? ""}</div>
                    <div>{m.variant?.name ?? m.variant_id}</div>
                    <div className="text-xs text-gray-500">{m.variant?.variant_type ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{m.type}</span>
                  </td>
                  <td className="px-3 py-2">{gToKg(m.qty_g)}</td>
                  <td className="px-3 py-2">{m.qty_units ?? 0}</td>
                  <td className="px-3 py-2 text-xs text-gray-700">{m.supplier_name ?? ""}</td>
                  <td className="px-3 py-2 text-xs text-gray-700">{m.cost_total ?? ""}</td>
                  <td className="px-3 py-2 text-xs text-gray-700">{m.note ?? ""}</td>
                </tr>
              ))}

              {!loading && movements.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-sm text-gray-500" colSpan={8}>
                    No movements yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-gray-500">
          Note: This screen uses a Supabase RPC (Postgres function) so the inventory update + movement insert happen together.
        </div>
      </div>
    </div>
  );
}
