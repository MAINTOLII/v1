// Replaced implementation with Supabase-connected version

"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type PaymentMethod = "cod" | "transfer" | "credit";
type OrderStatus = "pending" | "confirmed" | "out_for_delivery" | "delivered" | "cancelled";
type VariantType = "weight" | "unit";

type Variant = {
  id: string;
  product_name: string;
  variant_name: string;
  variant_type: VariantType;
  sell_price?: number | null;
};

type CartLine = {
  variant_id: string;
  product_name: string;
  variant_name: string;
  variant_type: VariantType;
  qty_g?: number; // grams
  qty_units?: number;
  unit_price?: number;
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

function money(n: number) {
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function safeInt(v: string) {
  const n = Number.parseInt(v || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

function safeFloat(v: string) {
  const n = Number.parseFloat(v || "0");
  return Number.isFinite(n) ? n : 0;
}

function normalizePhone(raw: string) {
  return (raw || "").replace(/\D/g, "");
}

function formatErr(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e?.message) return String(e.message);
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

function lineTotal(line: CartLine) {
  const unit = Number(line.unit_price || 0);
  if (line.variant_type === "weight") {
    const g = Number(line.qty_g || 0);
    return unit * (g / 1000); // unit price per kg
  }
  return unit * Number(line.qty_units || 0);
}

export default function OnlineSection() {
  // --- Customer ---
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");

  // --- Order meta ---
  const [channel, setChannel] = useState<"website" | "whatsapp">("whatsapp");
  const [status, setStatus] = useState<OrderStatus>("pending");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cod");

  // --- Item search / selection ---
  const [q, setQ] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState<string>("");
  const [qtyG, setQtyG] = useState<string>("1000");
  const [qtyUnits, setQtyUnits] = useState<string>("1");

  // --- Variants (from DB) ---
  const [variants, setVariants] = useState<Variant[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsErr, setVariantsErr] = useState<string | null>(null);

  // --- Cart ---
  const [cart, setCart] = useState<CartLine[]>([]);

  // --- Save state ---
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadVariants() {
      setVariantsLoading(true);
      setVariantsErr(null);
      try {
        const supabase = getSupabase();

        // Join: product_variants -> products
        const { data, error } = await supabase
          .from("product_variants")
          .select("id, name, variant_type, sell_price, product:products(name)")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(2000);

        if (error) throw error;

        const rows: Variant[] = (data ?? []).map((r: any) => {
          const productName = r.product?.name ?? "(Product)";
          const vt: VariantType = String(r.variant_type) === "weight" ? "weight" : "unit";
          return {
            id: r.id,
            product_name: String(productName),
            variant_name: String(r.name ?? ""),
            variant_type: vt,
            sell_price: r.sell_price == null ? null : Number(r.sell_price),
          };
        });

        if (!cancelled) setVariants(rows);
      } catch (e) {
        if (!cancelled) setVariantsErr(formatErr(e));
      } finally {
        if (!cancelled) setVariantsLoading(false);
      }
    }

    loadVariants();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredVariants = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return variants;
    return variants.filter((v) =>
      `${v.product_name} ${v.variant_name}`.toLowerCase().includes(s)
    );
  }, [q, variants]);

  const selectedVariant = useMemo(
    () => variants.find((v) => v.id === selectedVariantId) || null,
    [variants, selectedVariantId]
  );

  const total = useMemo(() => {
    return cart.reduce((sum, line) => sum + lineTotal(line), 0);
  }, [cart]);

  function addToCart() {
    setSaveOk(null);
    setSaveErr(null);

    if (!selectedVariant) return;

    const unitPrice = Number(selectedVariant.sell_price ?? 0);

    if (selectedVariant.variant_type === "weight") {
      const grams = Math.max(0, safeInt(qtyG));
      if (!grams) return;
      setCart((prev) => [
        ...prev,
        {
          variant_id: selectedVariant.id,
          product_name: selectedVariant.product_name,
          variant_name: selectedVariant.variant_name,
          variant_type: "weight",
          qty_g: grams,
          unit_price: unitPrice,
        },
      ]);
    } else {
      const units = Math.max(0, safeInt(qtyUnits));
      if (!units) return;
      setCart((prev) => [
        ...prev,
        {
          variant_id: selectedVariant.id,
          product_name: selectedVariant.product_name,
          variant_name: selectedVariant.variant_name,
          variant_type: "unit",
          qty_units: units,
          unit_price: unitPrice,
        },
      ]);
    }

    // reset item input
    setSelectedVariantId("");
    setQ("");
  }

  function removeLine(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  function clearAll() {
    setCustomerName("");
    setCustomerPhone("");
    setAddress("");
    setNote("");
    setChannel("whatsapp");
    setStatus("pending");
    setPaymentMethod("cod");
    setQ("");
    setSelectedVariantId("");
    setCart([]);
    setSaveErr(null);
    setSaveOk(null);
  }

  const disabledReason = useMemo(() => {
    const digits = normalizePhone(customerPhone);
    if (digits.length < 6) return "Enter a valid phone number (at least 6 digits).";
    if (cart.length === 0) return "Add at least 1 item to the cart.";
    if (saving) return "Saving…";
    return null;
  }, [customerPhone, cart.length, saving]);

  const canCreate = disabledReason === null;

  async function createOrder() {
    if (!canCreate) return;

    setSaving(true);
    setSaveErr(null);
    setSaveOk(null);

    try {
      const supabase = getSupabase();

      const phoneInput = customerPhone.trim();
      const phoneDigits = normalizePhone(phoneInput);

      // 1) Find-or-create customer by phone
      let customerId: string | null = null;

      const { data: existing, error: exErr } = await supabase
        .from("customers")
        .select("id, name")
        .eq("phone", phoneInput)
        .maybeSingle();

      if (exErr) throw exErr;

      if (existing?.id) {
        customerId = existing.id;

        // If name is provided and missing in DB, fill it
        const nameTrim = customerName.trim();
        if (nameTrim && (!existing.name || String(existing.name).trim() === "")) {
          const { error: uErr } = await supabase
            .from("customers")
            .update({ name: nameTrim })
            .eq("id", existing.id);
          if (uErr) throw uErr;
        }
      } else {
        const { data: inserted, error: iErr } = await supabase
          .from("customers")
          .insert({
            phone: phoneInput,
            name: customerName.trim() || null,
          })
          .select("id")
          .single();

        if (iErr) throw iErr;
        customerId = inserted.id;
      }

      // 2) Insert order
      const { data: orderRow, error: orderErr } = await supabase
        .from("orders")
        .insert({
          customer_id: customerId,
          customer_phone: phoneInput,
          channel,
          status,
          payment_method: paymentMethod,
          payment_status: "unpaid",
          address: address.trim() || null,
          note: note.trim() || null,
          currency: "USD",
          subtotal: total,
          delivery_fee: 0,
          discount: 0,
          total,
          amount_paid: 0,
        })
        .select("id")
        .single();

      if (orderErr) throw orderErr;

      const orderId = orderRow.id as string;

      // 3) Insert order items
      const itemsPayload = cart.map((c) => ({
        order_id: orderId,
        variant_id: c.variant_id,
        qty_g: c.qty_g ?? null,
        qty_units: c.qty_units ?? null,
        unit_price: Number(c.unit_price || 0),
        line_total: lineTotal(c),
      }));

      const { error: itemsErr } = await supabase.from("order_items").insert(itemsPayload);
      if (itemsErr) throw itemsErr;

      setSaveOk(`Order created: #${orderId.slice(0, 8)} (phone ${phoneDigits})`);
      clearAll();
    } catch (e) {
      setSaveErr(formatErr(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-full overflow-x-hidden text-gray-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Online / WhatsApp Orders</h2>
          <p className="mt-1 text-sm text-gray-600">
            Create delivery orders, track status, and support <b>Credit (Pay later)</b> for trusted customers.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={clearAll}
            className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 sm:w-auto"
          >
            Clear
          </button>
          <div className="w-full sm:w-auto">
            <button
              type="button"
              onClick={createOrder}
              disabled={!canCreate}
              aria-disabled={!canCreate}
              title={disabledReason ?? ""}
              className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {saving ? "Saving…" : "Create order"}
            </button>
            {!canCreate && (
              <div className="mt-1 text-xs text-amber-700">{disabledReason}</div>
            )}
          </div>
        </div>
      </div>

      {saveErr && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {saveErr}
        </div>
      )}

      {saveOk && (
        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          {saveOk}
        </div>
      )}

      {variantsErr && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          Variants load error: {variantsErr}
        </div>
      )}

      {/* Customer + Meta */}
      <div className="mt-5 grid max-w-full gap-4 lg:grid-cols-3">
        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-sm font-semibold">Customer</div>

          <div className="mt-3 grid gap-3">
            <div>
              <label className="text-xs text-gray-600">Name (optional)</label>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                placeholder="e.g. Ahmed"
              />
            </div>

            <div>
              <label className="text-xs text-gray-600">Phone *</label>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                placeholder="e.g. 61xxxxxxx"
              />
              <div className="mt-1 text-xs text-gray-500">
                Used for WhatsApp + identifying trusted credit customers.
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-600">Delivery address</label>
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                rows={3}
                placeholder="Area, street, landmarks..."
              />
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-sm font-semibold">Order</div>

          <div className="mt-3 grid gap-3">
            <div>
              <label className="text-xs text-gray-600">Channel</label>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as any)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="website">Website</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-600">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as OrderStatus)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="out_for_delivery">Out for delivery</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div>
              <label className="text-xs text-gray-600">Payment method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="cod">Cash on delivery</option>
                <option value="transfer">Bank/Wallet transfer</option>
                <option value="credit">Credit (Pay later)</option>
              </select>
              {paymentMethod === "credit" && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="font-semibold">Credit enabled</div>
                  <div className="mt-1">
                    Keep payment as unpaid and collect later.
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-gray-600">Order note</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                rows={3}
                placeholder="e.g. Call on arrival, blue gate, deliver before 6pm"
              />
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-sm font-semibold">Summary</div>

          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <div className="text-gray-600">Items</div>
              <div className="font-medium">{cart.length}</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-gray-600">Total</div>
              <div className="font-semibold">${money(total)}</div>
            </div>
            <div className="pt-2 text-xs text-gray-500">
              Tip: Create <b>pending</b> → confirm when packed → deliver.
            </div>
          </div>
        </div>
      </div>

      {/* Add items */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Add items</div>
            <div className="mt-1 text-xs text-gray-500">
              {variantsLoading ? "Loading items…" : "Search variants and add to cart."}
            </div>
          </div>
        </div>

        <div className="mt-4 grid max-w-full gap-3 lg:grid-cols-5">
          <div className="relative min-w-0 lg:col-span-3">
            <label className="text-xs text-gray-600">Search</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="e.g. potato, nescafe, 95g"
            />

            <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-gray-200">
              {filteredVariants.map((v) => {
                const active = v.id === selectedVariantId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVariantId(v.id)}
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                      active ? "bg-gray-50" : ""
                    }`}
                  >
                    <div className="truncate font-medium text-gray-900">
                      {v.product_name} — {v.variant_name}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-600">
                      {v.variant_type === "weight" ? "Weight" : "Unit"}
                      {v.sell_price != null ? ` • $${money(Number(v.sell_price))}` : ""}
                    </div>
                  </button>
                );
              })}

              {!variantsLoading && filteredVariants.length === 0 && (
                <div className="px-3 py-3 text-sm text-gray-500">No matches.</div>
              )}
            </div>
          </div>

          <div className="min-w-0 lg:col-span-1">
            <label className="text-xs text-gray-600">Quantity</label>
            <div className="mt-1 rounded-lg border border-gray-200 p-3">
              <div className="text-xs text-gray-500">Selected</div>
              <div className="mt-1 truncate text-sm font-semibold text-gray-900">
                {selectedVariant
                  ? `${selectedVariant.product_name} — ${selectedVariant.variant_name}`
                  : "None"}
              </div>

              <div className="mt-3">
                {selectedVariant?.variant_type === "weight" ? (
                  <>
                    <label className="text-xs text-gray-600">Grams</label>
                    <input
                      value={qtyG}
                      onChange={(e) => setQtyG(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      inputMode="numeric"
                    />
                    <div className="mt-1 text-xs text-gray-500">1000g = 1kg</div>
                  </>
                ) : (
                  <>
                    <label className="text-xs text-gray-600">Units</label>
                    <input
                      value={qtyUnits}
                      onChange={(e) => setQtyUnits(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      inputMode="numeric"
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="min-w-0 lg:col-span-1">
            <label className="text-xs text-gray-600">Action</label>
            <button
              type="button"
              onClick={addToCart}
              disabled={!selectedVariant}
              className="mt-1 w-full rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              Add to cart
            </button>

            <div className="mt-3 rounded-lg border border-gray-200 p-3 text-xs text-gray-600">
              <div className="font-semibold text-gray-900">Pricing</div>
              <div className="mt-1">
                Weight price is per <b>kg</b>. Units are per item.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Cart */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">Cart</div>
          <div className="text-sm font-semibold">${money(total)}</div>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-[700px] w-full">
            <thead className="bg-gray-50">
              <tr className="text-left">
                <th className="px-3 py-2 text-xs font-medium text-gray-600">Product</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-600">Variant</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-600">Qty</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-600">Unit price</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-600">Line total</th>
                <th className="px-3 py-2 text-xs font-medium text-gray-600"></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((c, idx) => {
                const unit = Number(c.unit_price || 0);
                const lt = lineTotal(c);

                return (
                  <tr key={`${c.variant_id}-${idx}`} className="border-t">
                    <td className="px-3 py-2 text-xs text-gray-700">
                      <div className="max-w-[220px] truncate">{c.product_name}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      <div className="max-w-[220px] truncate">{c.variant_name}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      {c.variant_type === "weight"
                        ? `${safeFloat(String(c.qty_g || 0)).toFixed(0)}g`
                        : `${safeInt(String(c.qty_units || 0))} units`}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">${money(unit)}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-gray-900">${money(lt)}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}

              {cart.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                    No items yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-gray-500">
          This creates records in <b>orders</b> + <b>order_items</b>. Inventory reduction should happen when you confirm the order.
        </div>
      </div>
    </div>
  );
}