// replacement: fetches directly from Supabase, no missing API routes
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type OrderStatus = "pending" | "confirmed" | "out_for_delivery" | "delivered" | "cancelled";

type OrderRow = {
  id: string;
  customer_id: string | null;
  customer_phone: string | null;
  channel: string;
  status: string;
  payment_method: string;
  payment_status: string;
  currency: string;
  subtotal: number;
  delivery_fee: number;
  discount: number;
  total: number;
  amount_paid: number;
  address: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  variant_id: string;
  qty_g: number | null;
  qty_units: number | null;
  unit_price: number;
  line_total: number;
  created_at: string;
  product_name: string | null;
  variant_name: string | null;
  variant_type: string | null;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Add them to your .env.local"
    );
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

function money(n: unknown) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.00";
  return x.toFixed(2);
}

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function formatErr(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e?.message) return e.message;
  const bits: string[] = [];
  if (e?.code) bits.push(`code: ${e.code}`);
  if (e?.details) bits.push(`details: ${e.details}`);
  if (e?.hint) bits.push(`hint: ${e.hint}`);
  if (bits.length) return bits.join(" • ");
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

const STATUSES: { key: OrderStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "confirmed", label: "Confirmed" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];

function safeStatus(v: string): v is OrderStatus {
  return (
    v === "pending" ||
    v === "confirmed" ||
    v === "out_for_delivery" ||
    v === "delivered" ||
    v === "cancelled"
  );
}

function toStatus(v: string): OrderStatus {
  return safeStatus(v) ? (v as OrderStatus) : "pending";
}

export default function ViewOrdersSection() {
  const [status, setStatus] = useState<OrderStatus>("pending");
  const [q, setQ] = useState("");

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersErr, setOrdersErr] = useState<string | null>(null);

  const [activeOrderId, setActiveOrderId] = useState<string>("");
  const [activeOrder, setActiveOrder] = useState<OrderRow | null>(null);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState<string | null>(null);

  const [updating, setUpdating] = useState(false);
  const [updateErr, setUpdateErr] = useState<string | null>(null);
  const [updateOk, setUpdateOk] = useState<string | null>(null);

  const [editStatus, setEditStatus] = useState<OrderStatus>("pending");
  const [editPaymentMethod, setEditPaymentMethod] = useState<string>("cod");
  const [editPaymentStatus, setEditPaymentStatus] = useState<string>("unpaid");
  const [editAddress, setEditAddress] = useState<string>("");
  const [editNote, setEditNote] = useState<string>("");

  const filteredOrders = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return orders;
    return orders.filter((o) => {
      const phone = (o.customer_phone || "").toLowerCase();
      const note = (o.note || "").toLowerCase();
      const addr = (o.address || "").toLowerCase();
      return (
        phone.includes(s) ||
        note.includes(s) ||
        addr.includes(s) ||
        o.id.toLowerCase().includes(s)
      );
    });
  }, [orders, q]);

  const totals = useMemo(() => {
    const total = filteredOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const unpaidCount = filteredOrders.filter(
      (o) => (o.payment_status || "").toLowerCase() !== "paid"
    ).length;
    return { total, unpaidCount, count: filteredOrders.length };
  }, [filteredOrders]);

  async function loadOrders(nextStatus: OrderStatus) {
    setOrdersLoading(true);
    setOrdersErr(null);

    try {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, customer_id, customer_phone, channel, status, payment_method, payment_status, currency, subtotal, delivery_fee, discount, total, amount_paid, address, note, created_at, updated_at"
        )
        .eq("status", nextStatus)
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) throw error;

      setOrders((data ?? []) as any);
      setActiveOrderId("");
      setActiveOrder(null);
      setItems([]);
      setDetailErr(null);
    } catch (e: any) {
      setOrdersErr(formatErr(e));
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }

  async function loadOrderDetails(orderId: string) {
    if (!orderId) return;

    setDetailLoading(true);
    setDetailErr(null);

    try {
      const supabase = getSupabase();

      // 1) Load the order
      const { data: o, error: oErr } = await supabase
        .from("orders")
        .select(
          "id, customer_id, customer_phone, channel, status, payment_method, payment_status, currency, subtotal, delivery_fee, discount, total, amount_paid, address, note, created_at, updated_at"
        )
        .eq("id", orderId)
        .single();

      if (oErr) throw oErr;
      setActiveOrder(o as any);

      // seed edit form
      setEditStatus(toStatus(String((o as any).status || "pending")));
      setEditPaymentMethod(String((o as any).payment_method || "cod"));
      setEditPaymentStatus(String((o as any).payment_status || "unpaid"));
      setEditAddress(String((o as any).address || ""));
      setEditNote(String((o as any).note || ""));
      setUpdateErr(null);
      setUpdateOk(null);

      // 2) Load items with joins (order_items -> product_variants -> products)
      const { data, error } = await supabase
        .from("order_items")
        .select(
          "id, order_id, variant_id, qty_g, qty_units, unit_price, line_total, created_at, variant:product_variants(name, variant_type, product:products(name))"
        )
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      const rows: OrderItemRow[] = (data ?? []).map((r: any) => {
        const v = r.variant;
        const productName = v?.product?.name ?? null;
        const variantName = v?.name ?? null;
        const variantType = v?.variant_type ?? null;
        return {
          id: r.id,
          order_id: r.order_id,
          variant_id: r.variant_id,
          qty_g: r.qty_g == null ? null : Number(r.qty_g),
          qty_units: r.qty_units == null ? null : Number(r.qty_units),
          unit_price: Number(r.unit_price ?? 0),
          line_total: Number(r.line_total ?? 0),
          created_at: r.created_at,
          product_name: productName,
          variant_name: variantName,
          variant_type: variantType,
        };
      });

      setItems(rows);
    } catch (e: any) {
      setDetailErr(formatErr(e));
      setActiveOrder(null);
      setItems([]);
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshActive() {
    if (!activeOrderId) return;
    await loadOrderDetails(activeOrderId);
    // Also refresh the list for the current status tab
    await loadOrders(status);
  }

  async function saveChanges() {
    if (!activeOrderId) return;

    setUpdating(true);
    setUpdateErr(null);
    setUpdateOk(null);

    try {
      const supabase = getSupabase();

      const patch: any = {
        status: editStatus,
        payment_method: editPaymentMethod,
        payment_status: editPaymentStatus,
        address: editAddress.trim() || null,
        note: editNote.trim() || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("orders").update(patch).eq("id", activeOrderId);
      if (error) throw error;

      setUpdateOk("Saved.");
      await refreshActive();
    } catch (e: any) {
      setUpdateErr(formatErr(e));
    } finally {
      setUpdating(false);
    }
  }

  async function confirmOrder() {
    if (!activeOrderId) return;

    setUpdating(true);
    setUpdateErr(null);
    setUpdateOk(null);

    try {
      const supabase = getSupabase();

      // Must succeed: confirm_order() deducts inventory + writes inventory_movements
      const { error: rpcErr } = await supabase.rpc("confirm_order", { p_order_id: activeOrderId });
      if (rpcErr) {
        const msg = formatErr(rpcErr);
        // Extra hint: common if RLS blocks function execution or table writes
        throw new Error(
          `${msg}\n\nIf you see permission/RLS errors, allow your admin role to execute confirm_order() and write to inventory_movements/inventory.`
        );
      }

      // Verify that sale movements were written (this is what Sales page reads for cost)
      // If RLS blocks reading inventory_movements, this check may fail; we'll ignore that but still refresh.
      try {
        const { data: mv, error: mvErr } = await supabase
          .from("inventory_movements")
          .select("id, cost_total")
          .eq("order_id", activeOrderId)
          .eq("type", "sale")
          .limit(5);

        if (!mvErr) {
          const count = (mv ?? []).length;
          const sum = (mv ?? []).reduce((s: number, r: any) => s + Number(r.cost_total ?? 0), 0);

          if (count === 0) {
            setUpdateErr(
              "Confirmed, but NO 'sale' inventory movements were created for this order. Sales cost will show 0.\n\nFix: ensure confirm_order() inserts inventory_movements with type='sale' and order_id, and that RLS allows those inserts."
            );
          } else if (sum === 0) {
            setUpdateErr(
              "Confirmed, but sale movements cost_total is 0. Sales cost will show 0.\n\nFix: set inventory.avg_cost_per_unit / avg_cost_per_g via restocks (or compute cost_total correctly on sale)."
            );
          } else {
            setUpdateOk(`Confirmed. Sale movements created. (sample cost sum: $${sum.toFixed(2)})`);
          }
        } else {
          // If we can't read movements due to RLS, still show success and refresh.
          setUpdateOk("Confirmed. Inventory deducted.");
        }
      } catch {
        setUpdateOk("Confirmed. Inventory deducted.");
      }

      await refreshActive();
    } catch (e: any) {
      setUpdateErr(formatErr(e));
    } finally {
      setUpdating(false);
    }
  }

  async function cancelOrder() {
    if (!activeOrderId) return;

    setUpdating(true);
    setUpdateErr(null);
    setUpdateOk(null);

    try {
      const supabase = getSupabase();
      const { error } = await supabase
        .from("orders")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", activeOrderId);
      if (error) throw error;

      setUpdateOk("Cancelled.");
      await refreshActive();
    } catch (e: any) {
      setUpdateErr(formatErr(e));
    } finally {
      setUpdating(false);
    }
  }

  useEffect(() => {
    loadOrders(status).catch(() => void 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-full overflow-x-hidden text-gray-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Orders</h2>
          <p className="mt-1 text-sm text-gray-600">
            View online/WhatsApp orders by status. Click an order to see its items.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => loadOrders(status)}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 sm:w-auto"
            disabled={ordersLoading}
          >
            {ordersLoading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Status pills */}
      <div className="mt-4 flex max-w-full flex-wrap gap-2">
        {STATUSES.map((s) => {
          const active = s.key === status;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setStatus(s.key);
                setUpdateErr(null);
                setUpdateOk(null);
                loadOrders(s.key);
              }}
              className={`rounded-full px-3 py-1 text-xs ${
                active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Search + summary */}
      <div className="mt-4 grid max-w-full gap-3 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <label className="text-xs text-gray-600">Search (phone, note, address, order id)</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            placeholder="e.g. 61xxxxxxx"
          />
        </div>
        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between text-sm">
            <div className="text-gray-600">Count</div>
            <div className="font-semibold">{totals.count}</div>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <div className="text-gray-600">Not paid</div>
            <div className="font-semibold">{totals.unpaidCount}</div>
          </div>
          <div className="mt-1 flex items-center justify-between text-sm">
            <div className="text-gray-600">Total</div>
            <div className="font-semibold">${money(totals.total)}</div>
          </div>
        </div>
      </div>

      {/* List + Details */}
      <div className="mt-5 grid max-w-full gap-4 lg:grid-cols-5">
        {/* Orders list */}
        <div className="min-w-0 lg:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-200 p-3 text-sm font-semibold">Orders</div>

            {ordersErr && <div className="p-3 text-sm text-red-700">{ordersErr}</div>}

            <div className="max-h-[520px] overflow-auto">
              {ordersLoading && <div className="p-3 text-sm text-gray-500">Loading…</div>}

              {!ordersLoading && filteredOrders.length === 0 && (
                <div className="p-3 text-sm text-gray-500">No orders.</div>
              )}

              {filteredOrders.map((o) => {
                const isActive = o.id === activeOrderId;
                const pay = (o.payment_status || "").toLowerCase();
                const st = safeStatus(o.status) ? o.status : status;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      setActiveOrderId(o.id);
                      loadOrderDetails(o.id);
                    }}
                    className={`block w-full border-t border-gray-100 px-3 py-3 text-left hover:bg-gray-50 ${
                      isActive ? "bg-gray-50" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">
                          {o.customer_phone || "(no phone)"}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-gray-600">
                          {o.channel} • {o.payment_method} • {pay} • {st}
                        </div>
                        <div className="mt-1 truncate text-xs text-gray-500">{fmtDate(o.created_at)}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold">${money(o.total)}</div>
                        <div className="mt-0.5 text-xs text-gray-500">#{o.id.slice(0, 8)}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="min-w-0 lg:col-span-3">
          <div className="min-w-0 rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-200 p-3 text-sm font-semibold">Order details</div>

            {!activeOrderId && (
              <div className="p-4 text-sm text-gray-500">Select an order to view details.</div>
            )}

            {detailErr && <div className="p-4 text-sm text-red-700">{detailErr}</div>}

            {detailLoading && activeOrderId && <div className="p-4 text-sm text-gray-500">Loading…</div>}

            {activeOrder && !detailLoading && (
              <div className="p-4">
                <div className="grid max-w-full gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-500">Order</div>
                    <div className="truncate text-sm font-semibold">#{activeOrder.id}</div>
                    <div className="mt-1 text-xs text-gray-600">
                      {activeOrder.channel} • {activeOrder.status}
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      Pay: {activeOrder.payment_method} • {activeOrder.payment_status}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-gray-500">Customer</div>
                    <div className="truncate text-sm font-semibold">
                      {activeOrder.customer_phone || "(no phone)"}
                    </div>
                    {activeOrder.address && (
                      <div className="mt-1 line-clamp-2 text-xs text-gray-600">{activeOrder.address}</div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <button
                    type="button"
                    onClick={confirmOrder}
                    disabled={updating || String(activeOrder.status) !== "pending"}
                    className="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updating ? "Working…" : "Confirm"}
                  </button>

                  <button
                    type="button"
                    onClick={cancelOrder}
                    disabled={updating || activeOrder.status === "cancelled"}
                    className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={saveChanges}
                    disabled={updating}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save changes
                  </button>
                </div>

                {(updateErr || updateOk) && (
                  <div
                    className={`mt-3 rounded-lg border p-3 text-sm ${
                      updateErr
                        ? "border-red-200 bg-red-50 text-red-900"
                        : "border-green-200 bg-green-50 text-green-900"
                    }`}
                  >
                    {updateErr || updateOk}
                  </div>
                )}

                {/* Edit fields */}
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <div className="min-w-0">
                    <label className="text-xs text-gray-600">Status</label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as OrderStatus)}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="pending">Pending</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="out_for_delivery">Out for delivery</option>
                      <option value="delivered">Delivered</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="text-xs text-gray-600">Payment method</label>
                    <select
                      value={editPaymentMethod}
                      onChange={(e) => setEditPaymentMethod(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="cod">Cash on delivery</option>
                      <option value="transfer">Transfer</option>
                      <option value="credit">Credit</option>
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="text-xs text-gray-600">Payment status</label>
                    <select
                      value={editPaymentStatus}
                      onChange={(e) => setEditPaymentStatus(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="unpaid">Unpaid</option>
                      <option value="partial">Partial</option>
                      <option value="paid">Paid</option>
                    </select>
                  </div>

                  <div className="min-w-0 lg:col-span-3">
                    <label className="text-xs text-gray-600">Address</label>
                    <textarea
                      value={editAddress}
                      onChange={(e) => setEditAddress(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      placeholder="Area, street, landmark…"
                    />
                  </div>

                  <div className="min-w-0 lg:col-span-3">
                    <label className="text-xs text-gray-600">Note</label>
                    <textarea
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      rows={2}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      placeholder="Customer note…"
                    />
                  </div>
                </div>

                {activeOrder.note && (
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                    <div className="font-semibold text-gray-900">Note</div>
                    <div className="mt-1 whitespace-pre-wrap">{activeOrder.note}</div>
                  </div>
                )}

                <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-[720px] w-full">
                    <thead className="bg-gray-50">
                      <tr className="text-left">
                        <th className="px-3 py-2 text-xs font-medium text-gray-600">Item</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-600">Qty</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-600">Unit</th>
                        <th className="px-3 py-2 text-xs font-medium text-gray-600">Line</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => {
                        const label = (it.product_name || it.variant_name)
                          ? `${it.product_name || ""}${
                              it.product_name && it.variant_name ? " — " : ""
                            }${it.variant_name || ""}`.trim()
                          : `Variant ${it.variant_id.slice(0, 8)}`;

                        const qty =
                          it.qty_g != null
                            ? `${Number(it.qty_g).toFixed(0)}g`
                            : `${Number(it.qty_units || 0)} units`;

                        return (
                          <tr key={it.id} className="border-t">
                            <td className="px-3 py-2 text-xs text-gray-700">
                              <div className="max-w-[320px] truncate">{label}</div>
                            </td>
                            <td className="px-3 py-2 text-xs text-gray-700">{qty}</td>
                            <td className="px-3 py-2 text-xs text-gray-700">${money(it.unit_price)}</td>
                            <td className="px-3 py-2 text-xs font-semibold text-gray-900">
                              ${money(it.line_total)}
                            </td>
                          </tr>
                        );
                      })}

                      {items.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-500">
                            No items.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 grid max-w-full gap-3 sm:grid-cols-2">
                  <div className="min-w-0 text-xs text-gray-500">
                    <div>Created: {fmtDate(activeOrder.created_at)}</div>
                    <div>Updated: {fmtDate(activeOrder.updated_at)}</div>
                  </div>
                  <div className="min-w-0 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="text-gray-600">Subtotal</div>
                      <div className="font-medium">${money(activeOrder.subtotal)}</div>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <div className="text-gray-600">Delivery</div>
                      <div className="font-medium">${money(activeOrder.delivery_fee)}</div>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <div className="text-gray-600">Discount</div>
                      <div className="font-medium">-${money(activeOrder.discount)}</div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-gray-900 font-semibold">Total</div>
                      <div className="text-gray-900 font-semibold">${money(activeOrder.total)}</div>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <div className="text-gray-600">Paid</div>
                      <div className="font-medium">${money(activeOrder.amount_paid)}</div>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <div className="text-gray-600">Balance</div>
                      <div className="font-semibold">
                        ${money(
                          Math.max(Number(activeOrder.total) - Number(activeOrder.amount_paid), 0)
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="font-semibold">Important</div>
                  <div className="mt-1">
                    This page reads directly from Supabase using the anon key. Make sure your Supabase RLS policies allow
                    your admin user to read <code className="rounded bg-white/60 px-1">orders</code> and{" "}
                    <code className="rounded bg-white/60 px-1">order_items</code>. For production security, move this to
                    server routes using the service role.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Backwards-compatible alias
export function OrdersSection() {
  return <ViewOrdersSection />;
}