"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type OrderStatus = "confirmed" | "out_for_delivery" | "delivered";

type OrderRow = {
  id: string;
  created_at: string;
  channel: string;
  customer_phone: string | null;
  total: number;
  currency: string | null;
  order_items: Array<{
    id: string;
    variant_id: string;
    qty_g: number | null;
    qty_units: number | null;
    unit_price: number;
    line_total: number;
    variant: {
      id: string;
      name: string;
      variant_type: string;
      product: {
        name: string;
        brand: string | null;
      } | null;
    } | null;
  }>;
};

type MovementCostRow = {
  order_id: string | null;
  variant_id: string;
  cost_total: number | null;
};

type SaleItem = {
  order_item_id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  variant_type: "weight" | "unit";
  qty_kg: number;
  qty_units: number;
  unit_price: number;
  revenue_line: number;
  cost_line: number;
  profit_line: number;
};

type SaleOrder = {
  order_id: string;
  created_at: string;
  channel: string;
  customer: string | null;
  currency: string;
  items: SaleItem[];
  revenue: number;
  cost: number;
  profit: number;
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

function fmtMoney(n: number, currency = "USD") {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  const sym = currency === "USD" ? "$" : `${currency} `;
  return `${sign}${sym}${v.toFixed(2)}`;
}

function startOfDayISO(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function addDaysISO(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function toLocalDateInputValue(d: Date) {
  // YYYY-MM-DD for <input type="date">
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fromLocalDateInputValue(v: string) {
  // Treat as local date
  const [y, m, d] = v.split("-").map((x) => Number(x));
  if (!y || !m || !d) return new Date();
  const dt = new Date();
  dt.setFullYear(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export default function SalesSection() {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<SaleOrder | null>(null);

  const [day, setDay] = useState(() => toLocalDateInputValue(new Date()));
  const [rows, setRows] = useState<SaleOrder[]>([]);

  async function loadSalesForDay(dayStr: string) {
    const dayDate = fromLocalDateInputValue(dayStr);
    const from = startOfDayISO(dayDate);
    const to = addDaysISO(dayDate, 1);

    // 1) Load confirmed/delivered orders for the day
    // Treat these as "sales".
    const { data: orders, error: oErr } = await supabase
      .from("orders")
      .select(
        "id,created_at,channel,customer_phone,total,currency,order_items(id,variant_id,qty_g,qty_units,unit_price,line_total,variant:product_variants(id,name,variant_type,product:products(name,brand)))"
      )
      .in("status", ["confirmed", "out_for_delivery", "delivered"] satisfies OrderStatus[])
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: false })
      .limit(800);

    if (oErr) throw oErr;

    const orderList = (orders ?? []) as any as OrderRow[];

    // 2) Load cost movements for these orders (requires inventory_movements.order_id + cost_total)
    const ids = orderList.map((o) => o.id);

    let costByOrder = new Map<string, number>();
    let costByOrderVariant = new Map<string, number>();

    if (ids.length) {
      const { data: moves, error: mErr } = await supabase
        .from("inventory_movements")
        .select("order_id,variant_id,cost_total")
        .eq("type", "sale")
        .in("order_id", ids)
        .limit(5000);

      if (mErr) throw mErr;

      for (const r of (moves ?? []) as any as MovementCostRow[]) {
        if (!r.order_id) continue;
        const c = Number(r.cost_total ?? 0);
        const prev = costByOrder.get(r.order_id) ?? 0;
        costByOrder.set(r.order_id, prev + c);

        const key = `${r.order_id}::${r.variant_id}`;
        costByOrderVariant.set(key, (costByOrderVariant.get(key) ?? 0) + c);
      }
    }

    // 3) Build SaleOrder list
    const sales: SaleOrder[] = orderList.map((o) => {
      const currency = o.currency || "USD";
      const customer = o.customer_phone || null;

      const items: SaleItem[] = (o.order_items ?? []).map((it) => {
        const vType = (it.variant?.variant_type ?? "").toLowerCase() === "weight" ? "weight" : "unit";

        const g = Math.abs(Number(it.qty_g ?? 0));
        const u = Math.abs(Number(it.qty_units ?? 0));

        const productNameBase = it.variant?.product?.name ?? "(Unknown product)";
        const brand = it.variant?.product?.brand ? ` (${it.variant?.product?.brand})` : "";
        const productName = `${productNameBase}${brand}`.trim();

        const revenueLine = Number(it.line_total ?? 0);
        const costLine = costByOrderVariant.get(`${o.id}::${it.variant_id}`) ?? 0;

        return {
          order_item_id: it.id,
          variant_id: it.variant_id,
          product_name: productName,
          variant_name: it.variant?.name ?? "(Unknown variant)",
          variant_type: vType,
          qty_kg: vType === "weight" ? g / 1000 : 0,
          qty_units: vType === "unit" ? u : 0,
          unit_price: Number(it.unit_price ?? 0),
          revenue_line: revenueLine,
          cost_line: costLine,
          profit_line: revenueLine - costLine,
        };
      });

      const revenue = Number(o.total ?? 0);
      const cost = costByOrder.get(o.id) ?? 0;
      const profit = revenue - cost;

      // Sort items for display
      items.sort((a, b) => b.profit_line - a.profit_line);

      return {
        order_id: o.id,
        created_at: o.created_at,
        channel: o.channel,
        customer,
        currency,
        items,
        revenue,
        cost,
        profit,
      };
    });

    setRows(sales);
  }

  async function refresh() {
    setLoading(true);
    setErrorMsg(null);
    try {
      await loadSalesForDay(day);
    } catch (e: any) {
      console.error("SalesSection refresh error:", e);
      setErrorMsg(formatErr(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto refresh when day changes
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((o) => {
      const hay = `${o.order_id} ${o.customer ?? ""} ${o.channel}`.toLowerCase();
      if (hay.includes(needle)) return true;
      return o.items.some((it) => `${it.product_name} ${it.variant_name}`.toLowerCase().includes(needle));
    });
  }, [rows, q]);

  const summary = useMemo(() => {
    const currency = filtered[0]?.currency || "USD";
    const revenue = filtered.reduce((s, o) => s + Number(o.revenue || 0), 0);
    const cost = filtered.reduce((s, o) => s + Number(o.cost || 0), 0);
    const profit = revenue - cost;
    return { currency, revenue, cost, profit, count: filtered.length };
  }, [filtered]);

  return (
    <div className="text-gray-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Sales</h2>
          <p className="mt-2 text-sm text-gray-600">
            Sales are <b>confirmed / delivered</b> orders. Shows daily revenue, cost (from inventory movements), and profit.
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

      <div className="mt-6 grid gap-3 rounded-xl border p-4 lg:grid-cols-4">
        <div>
          <label className="text-xs text-gray-600">Day</label>
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="lg:col-span-2">
          <label className="text-xs text-gray-600">Search</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            placeholder="phone / order id / product"
          />
        </div>

        <div className="flex items-end justify-end text-sm text-gray-600">{filtered.length} sale(s)</div>

        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-500">Revenue</div>
          <div className="mt-1 text-sm font-semibold">{fmtMoney(summary.revenue, summary.currency)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-500">Cost</div>
          <div className="mt-1 text-sm font-semibold">{fmtMoney(summary.cost, summary.currency)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-500">Profit</div>
          <div className="mt-1 text-sm font-semibold">{fmtMoney(summary.profit, summary.currency)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-500">Orders</div>
          <div className="mt-1 text-sm font-semibold">{summary.count}</div>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Channel</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Revenue</th>
              <th className="px-3 py-2">Cost</th>
              <th className="px-3 py-2">Profit</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <tr key={o.order_id} className="border-t">
                <td className="px-3 py-2 text-xs text-gray-700">{new Date(o.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-xs text-gray-700">#{o.order_id.slice(0, 8)}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{o.channel}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{o.customer ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{fmtMoney(o.revenue, o.currency)}</td>
                <td className="px-3 py-2 text-xs text-gray-700">{fmtMoney(o.cost, o.currency)}</td>
                <td className="px-3 py-2 text-xs font-semibold text-gray-900">{fmtMoney(o.profit, o.currency)}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSelected(o)}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    View items
                  </button>
                </td>
              </tr>
            ))}

            {filtered.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-sm text-gray-500" colSpan={8}>
                  No sales for this day.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-5xl rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">Sale details</div>
                <div className="mt-1 text-xs text-gray-600">
                  #{selected.order_id.slice(0, 8)} • {selected.channel} • {selected.customer ?? "No customer"} •{" "}
                  {new Date(selected.created_at).toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-gray-600">
                  Revenue: <b>{fmtMoney(selected.revenue, selected.currency)}</b> • Cost: <b>{fmtMoney(selected.cost, selected.currency)}</b> • Profit:{" "}
                  <b>{fmtMoney(selected.profit, selected.currency)}</b>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs text-gray-600">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Variant</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2">Unit price</th>
                    <th className="px-3 py-2">Revenue</th>
                    <th className="px-3 py-2">Cost</th>
                    <th className="px-3 py-2">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((it) => {
                    const qtyTxt = it.variant_type === "weight" ? `${it.qty_kg.toFixed(3)}kg` : `${it.qty_units} units`;
                    return (
                      <tr key={it.order_item_id} className="border-t">
                        <td className="px-3 py-2 text-xs text-gray-700">{it.product_name}</td>
                        <td className="px-3 py-2 text-xs text-gray-700">{it.variant_name}</td>
                        <td className="px-3 py-2 text-xs text-gray-700">{qtyTxt}</td>
                        <td className="px-3 py-2 text-xs text-gray-700">{fmtMoney(it.unit_price, selected.currency)}</td>
                        <td className="px-3 py-2 text-xs text-gray-700">{fmtMoney(it.revenue_line, selected.currency)}</td>
                        <td className="px-3 py-2 text-xs text-gray-700">{fmtMoney(it.cost_line, selected.currency)}</td>
                        <td className="px-3 py-2 text-xs font-semibold text-gray-900">{fmtMoney(it.profit_line, selected.currency)}</td>
                      </tr>
                    );
                  })}

                  <tr className="border-t bg-gray-50">
                    <td className="px-3 py-2 text-xs font-semibold" colSpan={4}>
                      Totals
                    </td>
                    <td className="px-3 py-2 text-xs font-semibold">{fmtMoney(selected.revenue, selected.currency)}</td>
                    <td className="px-3 py-2 text-xs font-semibold">{fmtMoney(selected.cost, selected.currency)}</td>
                    <td className="px-3 py-2 text-xs font-semibold">{fmtMoney(selected.profit, selected.currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="font-semibold">If cost shows 0</div>
              <div className="mt-1">
                Cost comes from <code className="rounded bg-white/60 px-1">inventory_movements</code> rows with type{' '}
                <code className="rounded bg-white/60 px-1">sale</code> and an{' '}
                <code className="rounded bg-white/60 px-1">order_id</code>. This is written when you confirm orders via the DB
                function <code className="rounded bg-white/60 px-1">confirm_order()</code>.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}