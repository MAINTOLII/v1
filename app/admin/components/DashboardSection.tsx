"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

function formatErr(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  if (e?.error_description) return e.error_description;
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

function money(n: number) {
  const v = Number(n || 0);
  return `$${v.toFixed(2)}`;
}

function startOfTodayUtcIso() {
  const now = new Date();
  // Use user's local day boundary but convert to ISO for querying timestamptz
  const localStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return localStart.toISOString();
}

type OrderRow = {
  id: string;
  created_at: string;
  status: string;
  total: number;
  customer_phone: string | null;
};

type MovementRow = {
  id: string;
  created_at: string;
  type: string;
  cost_total: number | null;
  order_id: string | null;
};

type InventoryRow = {
  variant_id: string;
  qty_g: number | string | null;
  qty_units: number | string | null;
  reorder_level_g: number | string | null;
  reorder_level_units: number | string | null;
  variant?: {
    id: string;
    name: string;
    sku: string | null;
    pack_size_g: number | null;
    product?: { name: string; brand: string | null } | null;
  } | null;
};

type CreditRow = {
  id: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  amount: number;
  amount_paid: number;
  status: string;
  note: string | null;
  created_at: string;
  paid_at?: string | null;
};

type CreditGroup = {
  key: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  total_amount: number;
  total_paid: number;
  total_balance: number;
  last_activity_at: string;
  rows: CreditRow[];
};

function nnum(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function creditPaidAmount(c: any): number {
  return nnum(c.amount_paid ?? 0);
}

function creditBalance(c: any): number {
  return Math.max(nnum(c.amount) - creditPaidAmount(c), 0);
}

function isOutstanding(c: CreditRow): boolean {
  return creditBalance(c as any) > 0.000001;
}

function groupCredits(rows: CreditRow[]): CreditGroup[] {
  const m = new Map<string, CreditGroup>();

  for (const r of rows) {
    const customerId = r.customer_id ?? null;
    const phone = String((r as any).customer_phone || "").trim();
    const name = String((r as any).customer_name || "").trim();
    const key = customerId || (phone ? `phone:${phone}` : name ? `name:${name}` : `id:${r.id}`);

    const amt = nnum((r as any).amount);
    const paid = creditPaidAmount(r as any);
    const bal = creditBalance(r as any);
    const ts = String((r as any).paid_at || r.created_at || "");

    const g = m.get(key);
    if (!g) {
      m.set(key, {
        key,
        customer_id: customerId,
        customer_name: name || "(no name)",
        customer_phone: phone,
        total_amount: amt,
        total_paid: paid,
        total_balance: bal,
        last_activity_at: ts,
        rows: [r],
      });
    } else {
      g.total_amount += amt;
      g.total_paid += paid;
      g.total_balance += bal;
      g.rows.push(r);
      if (new Date(ts).getTime() > new Date(g.last_activity_at).getTime()) g.last_activity_at = ts;
      if (!g.customer_phone) g.customer_phone = phone;
      if (!g.customer_name || g.customer_name === "(no name)") g.customer_name = name || g.customer_name;
    }
  }

  const groups = Array.from(m.values());
  groups.sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime());
  for (const g of groups) {
    g.rows.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  return groups;
}

type SupplierLinkRow = {
  supplier_id: string;
  variant_id: string;
  is_primary: boolean;
  supplier?: { name: string; phone: string | null } | null;
};

export default function DashboardSection() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Finance
  const [revenue, setRevenue] = useState(0);
  const [cost, setCost] = useState(0);

  // Sales
  const [lastOrders, setLastOrders] = useState<OrderRow[]>([]);
  const [mostSoldLabel, setMostSoldLabel] = useState<string>("—");
  const [mostSoldQty, setMostSoldQty] = useState<string>("");

  // Stock
  const [lowStock, setLowStock] = useState<InventoryRow[]>([]);
  const [primarySuppliers, setPrimarySuppliers] = useState<Record<string, { name: string; phone: string | null }>>(
    {}
  );

  // Credits (grouped like Credits page)
  const [creditRows, setCreditRows] = useState<CreditRow[]>([]);
  const [activeCreditKey, setActiveCreditKey] = useState<string>("");
  const [creditPayAmount, setCreditPayAmount] = useState<string>("");
  const [creditPayNote, setCreditPayNote] = useState<string>("");
  const [creditSaving, setCreditSaving] = useState(false);
  const [creditMsg, setCreditMsg] = useState<string | null>(null);

  const profit = useMemo(() => revenue - cost, [revenue, cost]);
  const profitAfterExpenses = useMemo(() => profit - 15, [profit]);

  const creditGroups = useMemo(() => {
    const outstanding = creditRows.filter((c) => isOutstanding(c));
    return groupCredits(outstanding);
  }, [creditRows]);

  const creditsOutstandingTotal = useMemo(() => {
    return creditGroups.reduce((s, g) => s + Number(g.total_balance ?? 0), 0);
  }, [creditGroups]);

  const activeCreditGroup = useMemo(() => {
    if (!activeCreditKey) return null;
    return creditGroups.find((g) => g.key === activeCreditKey) || null;
  }, [activeCreditKey, creditGroups]);

  async function loadDashboard() {
    setLoading(true);
    setErr(null);

    try {
      const since = startOfTodayUtcIso();

      // 1) Revenue: confirmed+ orders today
      const { data: ordersData, error: ordersErr } = await supabase
        .from("orders")
        .select("id,created_at,status,total,customer_phone")
        .gte("created_at", since)
        .in("status", ["confirmed", "out_for_delivery", "delivered"])
        .order("created_at", { ascending: false })
        .limit(200);
      if (ordersErr) throw ordersErr;

      const orders = (ordersData ?? []) as any as OrderRow[];
      setLastOrders(orders.slice(0, 5));
      setRevenue(orders.reduce((s, o) => s + Number(o.total ?? 0), 0));

      // 2) Cost: sum sale movements today
      // (Sales page reads from inventory_movements.type='sale')
      const { data: mvData, error: mvErr } = await supabase
        .from("inventory_movements")
        .select("id,created_at,type,cost_total,order_id")
        .gte("created_at", since)
        .eq("type", "sale")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (mvErr) throw mvErr;

      const mv = (mvData ?? []) as any as MovementRow[];
      setCost(mv.reduce((s, m) => s + Number(m.cost_total ?? 0), 0));

      // 3) Most sold item today: derive from order_items for today's confirmed+ orders
      const orderIds = orders.map((o) => o.id);
      if (orderIds.length > 0) {
        const { data: itemsData, error: itemsErr } = await supabase
          .from("order_items")
          .select(
            "id,order_id,variant_id,qty_g,qty_units,variant:product_variants(id,name,pack_size_g,sku,product:products(name,brand))"
          )
          .in("order_id", orderIds)
          .limit(2000);
        if (itemsErr) throw itemsErr;

        const items = (itemsData ?? []) as any[];
        const map = new Map<string, { label: string; units: number; g: number }>();

        for (const it of items) {
          const vid: string = it.variant_id;
          const v = it.variant;
          const prodName = v?.product?.name ?? "";
          const brand = v?.product?.brand ? ` (${v.product.brand})` : "";
          const vName = v?.name ? ` — ${v.name}` : "";
          const label = `${prodName}${brand}${vName}`.trim() || vid;

          const u = Number(it.qty_units ?? 0) || 0;
          const g = Number(it.qty_g ?? 0) || 0;

          if (!map.has(vid)) map.set(vid, { label, units: 0, g: 0 });
          const agg = map.get(vid)!;
          agg.units += u;
          agg.g += g;
        }

        let best: { label: string; score: number; units: number; g: number } | null = null;
        for (const v of map.values()) {
          // Prefer units; grams converted to kg score
          const score = v.units * 1000000 + v.g; // weight items still compare among themselves
          if (!best || score > best.score) best = { label: v.label, score, units: v.units, g: v.g };
        }

        if (best) {
          setMostSoldLabel(best.label);
          if (best.units > 0) setMostSoldQty(`${best.units} unit(s)`);
          else if (best.g > 0) setMostSoldQty(`${(best.g / 1000).toFixed(3)} kg`);
          else setMostSoldQty("");
        } else {
          setMostSoldLabel("—");
          setMostSoldQty("");
        }
      } else {
        setMostSoldLabel("—");
        setMostSoldQty("");
      }

      // 4) Low stock: qty <= reorder level (units OR grams)
      const { data: invData, error: invErr } = await supabase
        .from("inventory")
        .select(
          "variant_id,qty_g,qty_units,reorder_level_g,reorder_level_units,variant:product_variants(id,name,sku,pack_size_g,product:products(name,brand))"
        )
        .order("updated_at", { ascending: true })
        .limit(500);
      if (invErr) throw invErr;

      const inv = (invData ?? []) as any as InventoryRow[];
      const low = inv.filter((r) => {
        const qU = Number(r.qty_units ?? 0) || 0;
        const rU = Number(r.reorder_level_units ?? 0) || 0;
        const qG = Number(r.qty_g ?? 0) || 0;
        const rG = Number(r.reorder_level_g ?? 0) || 0;
        const lowUnits = rU > 0 && qU <= rU;
        const lowGrams = rG > 0 && qG <= rG;
        return lowUnits || lowGrams;
      });
      setLowStock(low.slice(0, 8));

      // 5) Supplier prompts: load primary supplier per low-stock variant
      const variantIds = low.map((x) => x.variant_id);
      if (variantIds.length > 0) {
        const { data: spData, error: spErr } = await supabase
          .from("supplier_products")
          .select("supplier_id,variant_id,is_primary,supplier:suppliers(name,phone)")
          .in("variant_id", variantIds)
          .eq("active", true);

        if (!spErr) {
          const links = (spData ?? []) as any as SupplierLinkRow[];
          const bestByVariant: Record<string, { name: string; phone: string | null }> = {};

          for (const l of links) {
            const vId = l.variant_id;
            const s = l.supplier;
            if (!s?.name) continue;
            // Prefer primary supplier
            if (!bestByVariant[vId] || l.is_primary) {
              bestByVariant[vId] = { name: s.name, phone: s.phone ?? null };
            }
          }
          setPrimarySuppliers(bestByVariant);
        }
      } else {
        setPrimarySuppliers({});
      }

      // 6) Credits bar: load recent credits and group outstanding per person (supports partials)
      const { data: credData, error: credErr } = await supabase
        .from("credits")
        .select("id,customer_id,customer_name,customer_phone,amount,amount_paid,status,note,created_at,paid_at")
        .order("created_at", { ascending: false })
        .limit(800);
      if (credErr) throw credErr;

      const credRows = (credData ?? []).map((r: any) => ({
        ...r,
        amount: nnum(r.amount),
        amount_paid: r.amount_paid == null ? 0 : nnum(r.amount_paid),
      })) as CreditRow[];
      setCreditRows(credRows);
    } catch (e: any) {
      console.error("Dashboard load error:", e);
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copySupplierMessage(variant: InventoryRow) {
    const v = variant.variant;
    const prod = v?.product?.name ?? "Item";
    const brand = v?.product?.brand ? ` (${v.product.brand})` : "";
    const vname = v?.name ? ` — ${v.name}` : "";
    const label = `${prod}${brand}${vname}`.trim();

    const qU = Number(variant.qty_units ?? 0) || 0;
    const qG = Number(variant.qty_g ?? 0) || 0;
    const rU = Number(variant.reorder_level_units ?? 0) || 0;
    const rG = Number(variant.reorder_level_g ?? 0) || 0;

    const needTxt =
      qU > 0 || rU > 0
        ? `units now: ${qU} (reorder: ${rU})`
        : `kg now: ${(qG / 1000).toFixed(3)} (reorder: ${(rG / 1000).toFixed(3)})`;

    const sup = primarySuppliers[variant.variant_id];
    const supName = sup?.name ? sup.name : "Supplier";

    const msg = `Asc ${supName}, fadlan ii keen ${label}. Stock waa hoose. (${needTxt}). Mahadsanid.`;

    try {
      await navigator.clipboard.writeText(msg);
      alert("Message copied. Paste into WhatsApp/SMS.");
    } catch {
      alert(msg);
    }
  }


  async function applyPartialPaymentToActiveGroup() {
    if (!activeCreditGroup) return;

    setCreditMsg(null);

    const amt = Number(creditPayAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setCreditMsg("Enter a valid payment amount.");
      return;
    }

    const remaining = Number(activeCreditGroup.total_balance ?? 0);
    const pay = Math.min(amt, remaining);

    setCreditSaving(true);
    try {
      const now = new Date().toISOString();
      let left = pay;

      // oldest-first
      for (const row of activeCreditGroup.rows) {
        if (left <= 0) break;

        const bal = creditBalance(row as any);
        if (bal <= 0) continue;

        const take = Math.min(left, bal);
        const currentPaid = creditPaidAmount(row as any);
        const nextPaid = currentPaid + take;
        const nextBal = Math.max(nnum((row as any).amount) - nextPaid, 0);

        const { error } = await supabase
          .from("credits")
          .update({
            amount_paid: nextPaid,
            status: nextBal <= 0.000001 ? "paid" : "open",
            paid_at: nextBal <= 0.000001 ? now : null,
          })
          .eq("id", (row as any).id);

        if (error) throw error;

        left -= take;
      }

      // Optional: append note to newest credit row
      if (creditPayNote.trim()) {
        const newest = [...activeCreditGroup.rows].sort(
          (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0];
        if (newest) {
          await supabase
            .from("credits")
            .update({
              note: `${String((newest as any).note || "").trim()}${
                String((newest as any).note || "").trim() ? "\n" : ""
              }Payment: $${pay.toFixed(2)} • ${creditPayNote.trim()}`.trim(),
            })
            .eq("id", (newest as any).id);
        }
      }

      setCreditMsg(`Payment recorded: $${pay.toFixed(2)}.`);
      setCreditPayAmount("");
      setCreditPayNote("");
      await loadDashboard();

      // keep selection, but it may move after regroup; clear to avoid stale
      setActiveCreditKey("");
    } catch (e: any) {
      setCreditMsg(formatErr(e));
    } finally {
      setCreditSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Dashboard</h2>
          <p className="mt-2 text-sm text-gray-600">Today overview: finance, sales, stock, credits.</p>
        </div>
        <button
          type="button"
          onClick={loadDashboard}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {err && <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{err}</div>}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Finance bar */}
        <div className="rounded-2xl border bg-white p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold">Finance</div>
              <div className="mt-1 text-xs text-gray-600">Revenue, cost, profit (today).</div>
            </div>
            <div className="text-xs text-gray-500">Expenses: $15</div>
          </div>

<div className="mt-4 grid grid-cols-2 gap-3">            <div className="rounded-xl border bg-gray-50 p-3">
              <div className="text-xs text-gray-600">Revenue</div>
              <div className="mt-1 text-xl font-semibold">{money(revenue)}</div>
            </div>
            <div className="rounded-xl border bg-gray-50 p-3">
              <div className="text-xs text-gray-600">Cost</div>
              <div className="mt-1 text-xl font-semibold">{money(cost)}</div>
            </div>
            <div className="rounded-xl border bg-gray-50 p-3">
              <div className="text-xs text-gray-600">Profit</div>
              <div className="mt-1 text-xl font-semibold">{money(profit)}</div>
            </div>
            <div className="rounded-xl border bg-gray-50 p-3">
              <div className="text-xs text-gray-600">Profit after $15 expenses</div>
              <div className="mt-1 text-xl font-semibold">{money(profitAfterExpenses)}</div>
            </div>
          </div>

          <div className="mt-3 text-xs text-gray-500">
            Note: Cost comes from <b>inventory_movements</b> where <code>type='sale'</code>.
          </div>
        </div>

        {/* Sales bar */}
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-sm font-semibold">Sales</div>
          <div className="mt-1 text-xs text-gray-600">Most sold item + last 5 sales (today).</div>

          <div className="mt-4 rounded-xl border bg-gray-50 p-3">
            <div className="text-xs text-gray-600">Most sold</div>
            <div className="mt-1 text-sm font-semibold">{mostSoldLabel}</div>
            {mostSoldQty && <div className="mt-1 text-xs text-gray-600">Qty: {mostSoldQty}</div>}
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {lastOrders.map((o) => (
                  <tr key={o.id} className="border-t">
                    <td className="px-3 py-2 text-xs text-gray-700">{new Date(o.created_at).toLocaleTimeString()}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{o.id.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{o.customer_phone ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-gray-700">{money(Number(o.total ?? 0))}</td>
                  </tr>
                ))}
                {lastOrders.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-sm text-gray-500" colSpan={4}>
                      No sales yet today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Stock bar */}
        <div className="rounded-2xl border bg-white p-4">
<div className="text-sm font-semibold">Low stock</div>
<div className="mt-1 text-xs text-gray-600">Products below reorder level + quick supplier message.</div>

          <div className="mt-4 grid gap-3">
            {lowStock.map((r) => {
              const v = r.variant;
              const prod = v?.product?.name ?? "";
              const brand = v?.product?.brand ? ` (${v.product.brand})` : "";
              const vname = v?.name ? ` — ${v.name}` : "";
              const label = `${prod}${brand}${vname}`.trim() || r.variant_id;

              const qU = Number(r.qty_units ?? 0) || 0;
              const rU = Number(r.reorder_level_units ?? 0) || 0;
              const qG = Number(r.qty_g ?? 0) || 0;
              const rG = Number(r.reorder_level_g ?? 0) || 0;

              const info =
                rU > 0
                  ? `Units: ${qU} (reorder ${rU})`
                  : rG > 0
                  ? `Kg: ${(qG / 1000).toFixed(3)} (reorder ${(rG / 1000).toFixed(3)})`
                  : `Units: ${qU}, Kg: ${(qG / 1000).toFixed(3)}`;

              const sup = primarySuppliers[r.variant_id];
              const supTxt = sup?.name ? `Supplier: ${sup.name}` : "Supplier: —";

              return (
                <div key={r.variant_id} className="rounded-xl border bg-gray-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                     <div className="flex items-center gap-2">
  <div className="text-sm font-semibold">{label}</div>
  <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
    LOW
  </span>
</div>
                      <div className="mt-1 text-xs text-gray-700">{info}</div>
                      <div className="mt-1 text-xs text-gray-600">{supTxt}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copySupplierMessage(r)}
                      className="shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-50"
                    >
                      Copy message
                    </button>
                  </div>
                </div>
              );
            })}

            {lowStock.length === 0 && <div className="text-sm text-gray-500">No low stock items right now.</div>}
          </div>

          <div className="mt-3 text-xs text-gray-500">
            Tip: Link variants to suppliers in the Suppliers page so the message uses the primary supplier.
          </div>
        </div>

        {/* Credits bar */}
        <div className="rounded-2xl border bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Credits</div>
              <div className="mt-1 text-xs text-gray-600">Grouped outstanding per person + partial payments.</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-600">Total outstanding</div>
              <div className="text-lg font-semibold">{money(creditsOutstandingTotal)}</div>
              <div className="text-[11px] text-gray-500">{creditGroups.length} customer(s)</div>
            </div>
          </div>

          {creditMsg && (
            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900">{creditMsg}</div>
          )}

          <div className="mt-4 grid gap-3 lg:grid-cols-5">
            {/* Left: groups */}
            <div className="min-w-0 lg:col-span-2">
              <div className="overflow-hidden rounded-xl border">
                <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">Outstanding customers</div>
                <div className="max-h-[280px] overflow-auto">
                  {creditGroups.slice(0, 12).map((g) => {
                    const isActive = g.key === activeCreditKey;
                    const headline = g.customer_phone ? `${g.customer_name} • ${g.customer_phone}` : g.customer_name;

                    return (
                      <button
                        key={g.key}
                        type="button"
                        onClick={() => {
                          setActiveCreditKey(g.key);
                          setCreditPayAmount("");
                          setCreditPayNote("");
                          setCreditMsg(null);
                        }}
                        className={`block w-full border-t border-gray-100 px-3 py-3 text-left hover:bg-gray-50 ${
                          isActive ? "bg-gray-50" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-900">{headline}</div>
                            <div className="mt-0.5 truncate text-xs text-gray-600">{g.rows.length} time(s)</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-sm font-semibold">{money(g.total_balance)}</div>
                            <div className="mt-0.5 text-[11px] text-gray-500">Tap</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {creditGroups.length === 0 && (
                    <div className="px-3 py-6 text-center text-sm text-gray-500">No outstanding credits.</div>
                  )}
                </div>
              </div>

              <div className="mt-3 text-xs text-gray-500">
                Tip: Open the full Credits page for advanced search and full history.
              </div>
            </div>

            {/* Right: details + partial payment */}
            <div className="min-w-0 lg:col-span-3">
              <div className="rounded-xl border bg-white">
                <div className="border-b bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">Details</div>

                {!activeCreditGroup && (
                  <div className="p-4 text-sm text-gray-500">Select a customer to view credit history and record a payment.</div>
                )}

                {activeCreditGroup && (
                  <div className="p-4">
                    <div className="text-sm font-semibold">
                      {activeCreditGroup.customer_name}
                      {activeCreditGroup.customer_phone ? ` • ${activeCreditGroup.customer_phone}` : ""}
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      Total: {money(activeCreditGroup.total_amount)} • Paid: {money(activeCreditGroup.total_paid)} • Balance: {money(
                        activeCreditGroup.total_balance
                      )}
                    </div>

                    {activeCreditGroup.total_balance > 0 && (
                      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                        <div className="text-sm font-semibold">Record payment (partial ok)</div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                          <div className="min-w-0">
                            <label className="text-xs text-gray-600">Amount</label>
                            <input
                              value={creditPayAmount}
                              onChange={(e) => setCreditPayAmount(e.target.value)}
                              inputMode="decimal"
                              placeholder={`Max ${(Number(activeCreditGroup.total_balance) || 0).toFixed(2)}`}
                              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                            />
                          </div>
                          <div className="min-w-0 sm:col-span-2">
                            <label className="text-xs text-gray-600">Note</label>
                            <input
                              value={creditPayNote}
                              onChange={(e) => setCreditPayNote(e.target.value)}
                              placeholder="e.g. paid half"
                              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                            />
                          </div>
                        </div>

                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            onClick={applyPartialPaymentToActiveGroup}
                            disabled={creditSaving}
                            className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                          >
                            {creditSaving ? "Working…" : "Apply payment"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCreditPayAmount(String(activeCreditGroup.total_balance));
                              setCreditPayNote("full payment");
                            }}
                            disabled={creditSaving}
                            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Fill full amount
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
                      <table className="min-w-[720px] w-full">
                        <thead className="bg-gray-50">
                          <tr className="text-left">
                            <th className="px-3 py-2 text-xs font-medium text-gray-600">Date</th>
                            <th className="px-3 py-2 text-xs font-medium text-gray-600">Note</th>
                            <th className="px-3 py-2 text-xs font-medium text-gray-600">Amount</th>
                            <th className="px-3 py-2 text-xs font-medium text-gray-600">Paid</th>
                            <th className="px-3 py-2 text-xs font-medium text-gray-600">Balance</th>
                            <th className="px-3 py-2 text-xs font-medium text-gray-600">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeCreditGroup.rows.map((r: any) => {
                            const amt = nnum(r.amount);
                            const paid = creditPaidAmount(r);
                            const bal = creditBalance(r);
                            const st = String(r.status || (bal <= 0.000001 ? "paid" : "open"));
                            const rowBg = bal <= 0.000001 ? "bg-green-50" : "bg-red-50";

                            return (
                              <tr key={r.id} className={`border-t ${rowBg}`}>
                                <td className="px-3 py-2 text-xs text-gray-700">{new Date(String(r.created_at)).toLocaleString()}</td>
                                <td className="px-3 py-2 text-xs text-gray-700">
                                  <div className="max-w-[380px] truncate">{String(r.note || "—")}</div>
                                </td>
                                <td className="px-3 py-2 text-xs text-gray-700">{money(amt)}</td>
                                <td className="px-3 py-2 text-xs text-gray-700">{money(paid)}</td>
                                <td className="px-3 py-2 text-xs font-semibold text-gray-900">{money(bal)}</td>
                                <td className="px-3 py-2 text-xs text-gray-700">{st}</td>
                              </tr>
                            );
                          })}

                          {activeCreditGroup.rows.length === 0 && (
                            <tr>
                              <td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-500">
                                No history.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}