"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type VariantRow = {
  id: string;
  product_id: string;
  name: string;
  variant_type: string;
  pack_size_g: number | null;
  sell_price: number | null;
  sku: string | null;
  is_active: boolean;
  product?: {
    id: string;
    name: string;
    brand: string | null;
  } | null;
};

type CartItem = {
  variant_id: string;
  product_name: string;
  variant_name: string;
  variant_type: "weight" | "unit";
  qty_kg: string; // for weight
  qty_units: string; // for unit
  unit_price: string; // optional for quick total calc
};

type VariantSuggestion = VariantRow;

type CustomerRow = {
  id: string;
  name: string | null;
  phone: string;
};

function formatErr(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;

  // Standard Error
  if (e instanceof Error) {
    return e.message || "Unknown error";
  }

  // Supabase/PostgREST style
  if (e?.message) return e.message;
  if (e?.error_description) return e.error_description;
  if (e?.details && typeof e.details === "string") return e.details;

  const parts: string[] = [];
  if (e?.code) parts.push(`code: ${e.code}`);
  if (e?.status) parts.push(`status: ${e.status}`);
  if (e?.statusText) parts.push(`statusText: ${e.statusText}`);
  if (e?.hint) parts.push(`hint: ${e.hint}`);
  if (e?.details) parts.push(`details: ${e.details}`);
  if (parts.length) return parts.join(" • ");

  // Try to stringify including non-enumerable keys
  try {
    const keys = Object.getOwnPropertyNames(e);
    const obj: any = {};
    for (const k of keys) obj[k] = e[k];
    const s = JSON.stringify(obj);
    if (s && s !== "{}") return s;
  } catch {}

  try {
    const s2 = JSON.stringify(e);
    if (s2 && s2 !== "{}") return s2;
  } catch {}

  return "Unknown error (check console + Network tab)";
}

function toInt(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function kgToG(kg: string) {
  const n = Number(kg);
  if (!Number.isFinite(n)) return 0;
  // 3dp kg -> grams integer
  return Math.round(n * 1000);
}

function fmtMoney(n?: number | null) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return "";
  return v.toFixed(2);
}

function variantLabel(v: VariantRow) {
  const p = v.product?.name ?? "(Unknown product)";
  const b = v.product?.brand ? ` (${v.product?.brand})` : "";
  const sku = v.sku ? ` • ${v.sku}` : "";
  const vn = v.name ?? "";
  return `${p}${b} — ${vn}${sku}`.trim();
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

export default function FastSection() {
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [customerPhone, setCustomerPhone] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer" | "credit">("cash");

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerRow[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRow | null>(null);
  const customerTimer = useRef<number | null>(null);

  const [variantSuggestions, setVariantSuggestions] = useState<VariantSuggestion[]>([]);
  const variantTimer = useRef<number | null>(null);

  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [q, setQ] = useState("");

  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [qtyKg, setQtyKg] = useState("0.000");
  const [qtyUnits, setQtyUnits] = useState("1");

  const [cart, setCart] = useState<CartItem[]>([]);

  async function fetchCustomerSuggestions(term: string) {
    const needle = term.trim();
    if (needle.length < 2) {
      setCustomerSuggestions([]);
      return;
    }

    // Fail gracefully if table doesn't exist yet
    const { data, error } = await supabase
      .from("customers")
      .select("id,name,phone")
      .or(`name.ilike.%${needle}%,phone.ilike.%${needle}%`)
      .limit(10);

    if (error) {
      console.warn("customers lookup failed (safe to ignore if table not created yet):", error);
      setCustomerSuggestions([]);
      return;
    }

    setCustomerSuggestions((data ?? []) as any);
  }

  async function fetchVariantSuggestions(term: string) {
    const needle = term.trim();
    if (needle.length < 2) {
      setVariantSuggestions([]);
      return;
    }

    // 1) Variant matches (name/sku)
    const { data: v1, error: e1 } = await supabase
      .from("product_variants")
      .select("id,product_id,name,variant_type,pack_size_g,sell_price,sku,is_active")
      .eq("is_active", true)
      .or(`name.ilike.%${needle}%,sku.ilike.%${needle}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    if (e1) {
      console.warn("variant lookup failed:", e1);
      setVariantSuggestions([]);
      return;
    }

    // 2) Product matches (name/brand) -> fetch variants by product_id
    const { data: prods, error: e2 } = await supabase
      .from("products")
      .select("id")
      .or(`name.ilike.%${needle}%,brand.ilike.%${needle}%`)
      .limit(20);

    let v2: any[] = [];
    if (!e2 && (prods ?? []).length > 0) {
      const ids = (prods ?? []).map((p: any) => p.id);
      const { data: vv, error: e3 } = await supabase
        .from("product_variants")
        .select("id,product_id,name,variant_type,pack_size_g,sell_price,sku,is_active")
        .eq("is_active", true)
        .in("product_id", ids)
        .order("created_at", { ascending: false })
        .limit(30);
      if (!e3) v2 = (vv ?? []) as any[];
    }

    // Merge unique by id
    const map = new Map<string, any>();
    for (const r of (v1 ?? []) as any[]) map.set(r.id, r);
    for (const r of v2) map.set(r.id, r);

    const merged = Array.from(map.values()).slice(0, 20) as VariantRow[];
    const hydrated = await hydrateProducts(merged);
    setVariantSuggestions(hydrated as any);
  }

  async function loadVariants() {
    const { data, error } = await supabase
      .from("product_variants")
      .select("id,product_id,name,variant_type,pack_size_g,sell_price,sku,is_active")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) throw error;
    const hydrated = await hydrateProducts(((data ?? []) as any) as VariantRow[]);
    setVariants(hydrated as any);
  }

  useEffect(() => {
    setLoading(true);
    setErrorMsg(null);
    loadVariants()
      .catch((e) => {
        console.error("FastSection loadVariants error:", e);
        setErrorMsg(formatErr(e));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (customerTimer.current) window.clearTimeout(customerTimer.current);
    const term = customerQuery;
    if (term.trim().length < 2) {
      setCustomerSuggestions([]);
      return;
    }
    customerTimer.current = window.setTimeout(() => {
      fetchCustomerSuggestions(term).catch((e) => {
        console.warn("fetchCustomerSuggestions error:", e);
        setCustomerSuggestions([]);
      });
    }, 250);

    return () => {
      if (customerTimer.current) window.clearTimeout(customerTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerQuery]);

  useEffect(() => {
    if (variantTimer.current) window.clearTimeout(variantTimer.current);
    const term = q;
    if (term.trim().length < 2) {
      setVariantSuggestions([]);
      return;
    }
    variantTimer.current = window.setTimeout(() => {
      fetchVariantSuggestions(term).catch((e) => {
        console.warn("fetchVariantSuggestions error:", e);
        setVariantSuggestions([]);
      });
    }, 250);

    return () => {
      if (variantTimer.current) window.clearTimeout(variantTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const filteredVariants = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return variants;
    return variants.filter((v) => {
      const vn = v.name ?? "";
      const sku = v.sku ?? "";
      const pn = v.product?.name ?? "";
      const pb = v.product?.brand ?? "";
      const hay = `${pn} ${pb} ${vn} ${sku}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [variants, q]);

  const selectedVariant = useMemo(() => {
    if (!selectedVariantId) return null;
    return (
      variants.find((v) => v.id === selectedVariantId) ??
      variantSuggestions.find((v) => v.id === selectedVariantId) ??
      null
    );
  }, [variants, variantSuggestions, selectedVariantId]);

  function addToCart() {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedVariant) {
      setErrorMsg("Select a variant.");
      return;
    }

    const vt = (selectedVariant.variant_type ?? "").toLowerCase() === "weight" ? "weight" : "unit";

    if (vt === "weight") {
      const g = kgToG(qtyKg);
      if (g <= 0) {
        setErrorMsg("Enter a kg amount (e.g. 0.250).");
        return;
      }
    } else {
      const u = toInt(qtyUnits);
      if (u <= 0) {
        setErrorMsg("Enter units (e.g. 1). ");
        return;
      }
    }

    const productName = `${selectedVariant.product?.name ?? ""}${selectedVariant.product?.brand ? ` (${selectedVariant.product?.brand})` : ""}`.trim();

    const item: CartItem = {
      variant_id: selectedVariant.id,
      product_name: productName || "(No product name)",
      variant_name: selectedVariant.name,
      variant_type: vt,
      qty_kg: vt === "weight" ? qtyKg : "0.000",
      qty_units: vt === "unit" ? String(toInt(qtyUnits)) : "0",
      unit_price: fmtMoney(selectedVariant.sell_price),
    };

    setCart((prev) => [item, ...prev]);

    // reset quick inputs
    setSelectedVariantId("");
    setQtyKg("0.000");
    setQtyUnits("1");
  }

  function removeItem(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  const totalEstimate = useMemo(() => {
    let t = 0;
    for (const c of cart) {
      const p = Number(c.unit_price);
      if (!Number.isFinite(p) || p <= 0) continue;
      if (c.variant_type === "unit") {
        t += p * toInt(c.qty_units);
      } else {
        // If you price per kg, treat unit_price as per-kg
        t += p * Number(c.qty_kg);
      }
    }
    return t;
  }, [cart]);

  const itemsSummary = useMemo(() => {
    // short summary for credit note / receipt
    return cart
      .map((c) => {
        const qty = c.variant_type === "weight" ? `${Number(c.qty_kg).toFixed(3)}kg` : `${toInt(c.qty_units)}u`;
        const name = `${c.product_name}${c.variant_name ? ` — ${c.variant_name}` : ""}`.trim();
        return `${name} x ${qty}`;
      })
      .slice(0, 12)
      .join(" | ");
  }, [cart]);

  async function submitSaleAsOrder() {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (cart.length === 0) {
      setErrorMsg("Add at least 1 item.");
      return;
    }

    setLoading(true);
    try {
      // Simple receipt id for grouping in notes
      const receiptId = `POS-${Date.now()}`;
      const phoneClean = customerPhone.trim();
      const noteClean = note.trim();
      const custName = selectedCustomer?.name?.trim() ?? "";
      const custToken = custName && phoneClean ? `${custName} (${phoneClean})` : (custName || phoneClean);
      const header = [
        custToken ? `Customer: ${custToken}` : null,
        receiptId,
        noteClean ? `Note: ${noteClean}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      const total = Number(totalEstimate);
      const totalSafe = Number.isFinite(total) ? total : 0;

      // 1) Create an order so it shows in Sales page
      // IMPORTANT: rely on DB defaults for fields that may have CHECK constraints
      // (channel/payment_method/payment_status/currency/amount_paid).
      // We store the actual POS method in the note.
      const orderTotal = totalSafe;

      const baseNote = `${header} | POS payment:${paymentMethod}`;

      // Some DBs restrict orders.channel via CHECK (orders_channel_chk).
      // Try a small set of channels and infer "POS" in UI using the note.
      const channelCandidates = ["pos", "POS", "whatsapp", "store", "offline"].filter(Boolean);

      let orderId = "";
      let lastOrderErr: any = null;

      for (const ch of channelCandidates) {
        const orderPayload: any = {
          customer_id: selectedCustomer?.id ?? null,
          customer_phone: phoneClean || selectedCustomer?.phone || null,
          channel: ch,
          status: "pending",
          subtotal: orderTotal,
          delivery_fee: 0,
          discount: 0,
          total: orderTotal,
          // Put source on its own line so other pages can detect POS reliably
          note: `${baseNote}\nSource: Fast POS`,
          address: null,
        };

        const { data: orderRow, error: orderErr } = await supabase
          .from("orders")
          .insert(orderPayload)
          .select("id")
          .single();

        if (!orderErr && orderRow?.id) {
          orderId = String(orderRow.id);
          lastOrderErr = null;
          break;
        }

        lastOrderErr = orderErr;

        // If it's NOT the channel check, don't keep retrying.
        const msg = String(orderErr?.message ?? "");
        const details = String(orderErr?.details ?? "");
        if (!msg.includes("orders_channel_chk") && !details.includes("orders_channel_chk")) {
          break;
        }
      }

      if (!orderId) {
        console.error("Fast POS: order insert failed", {
          orderErr: lastOrderErr,
          keys: lastOrderErr ? Object.getOwnPropertyNames(lastOrderErr) : [],
        });
        throw new Error(`Order insert failed: ${formatErr(lastOrderErr)}`);
      }

      // Best-effort: for cash/transfer, record payment and mark order paid.
      // If your DB has strict constraints, these may fail; the order will still exist.
      if (paymentMethod !== "credit" && orderTotal > 0) {
        // 1) insert into payments table (safe; ignore errors)
        const { error: payErr } = await supabase.from("payments").insert({
          order_id: orderId,
          customer_id: selectedCustomer?.id ?? null,
          amount: orderTotal,
          method: paymentMethod === "cash" ? "cash" : "transfer",
          note: `Fast POS payment (${paymentMethod})`,
        });
        if (payErr) console.warn("Fast POS: payments insert failed (order still saved)", payErr);

        // 2) update order to paid (ignore errors if constrained)
        const { error: updErr } = await supabase
          .from("orders")
          .update({ payment_status: "paid", amount_paid: orderTotal })
          .eq("id", orderId);
        if (updErr) console.warn("Fast POS: order payment update failed (order still saved)", updErr);
      }

      // 2) Insert order items
      const orderItemsPayload = cart.map((c) => {
        const vt = c.variant_type;
        const qty_g = vt === "weight" ? kgToG(c.qty_kg) : null;
        const qty_units = vt === "unit" ? toInt(c.qty_units) : null;

        const unitPrice = Number(c.unit_price);
        const unit_price = Number.isFinite(unitPrice) ? unitPrice : 0;

        const line_total = vt === "unit" ? unit_price * toInt(c.qty_units) : unit_price * Number(c.qty_kg);

        return {
          order_id: orderId,
          variant_id: c.variant_id,
          qty_g,
          qty_units,
          unit_price,
          line_total: Number.isFinite(line_total) ? line_total : 0,
        };
      });

      // STEP B: insert order items
      const { error: oiErr } = await supabase.from("order_items").insert(orderItemsPayload);
      if (oiErr) {
        console.error("Fast POS: order_items insert failed", {
          oiErr,
          orderId,
          sampleItem: orderItemsPayload?.[0],
          keys: oiErr ? Object.getOwnPropertyNames(oiErr) : [],
        });
        throw new Error(`Order items insert failed: ${formatErr(oiErr)}`);
      }

      // 3) Confirm order via DB function so it writes inventory "sale" movements with cost_total
      // This ensures Sales page can show cost/profit for POS orders.
      const { error: confirmErr } = await supabase.rpc("confirm_order", { p_order_id: orderId });
      if (confirmErr) {
        console.error("Fast POS: confirm_order failed", {
          confirmErr,
          orderId,
          keys: confirmErr ? Object.getOwnPropertyNames(confirmErr) : [],
        });
        throw new Error(`Confirm order failed: ${formatErr(confirmErr)}`);
      }

      setCart([]);
      setCustomerPhone("");
      setCustomerQuery("");
      setSelectedCustomer(null);
      setCustomerSuggestions([]);
      setNote("");
      setPaymentMethod("cash");

      // If CREDIT is selected, create a credit record (best-effort)
      if (paymentMethod === "credit") {
        if (!totalSafe || totalSafe <= 0) {
          console.warn("credit skipped: total is 0");
        } else {
          const creditNote = [
            header,
            itemsSummary ? `Items: ${itemsSummary}` : null,
            "Source: Fast POS",
          ]
            .filter(Boolean)
            .join("\n");

          // Require at least a customer identifier
          const phone = phoneClean || selectedCustomer?.phone || "";
          const name = (selectedCustomer?.name ?? "").trim();

          // Best-effort insert: works with common columns; if it fails we still keep the inventory movements
          const payload: any = {
            amount: totalSafe,
            amount_paid: 0,
            status: "open",
            note: creditNote,
            created_at: new Date().toISOString(),
            customer_id: selectedCustomer?.id ?? null,
            customer_name: name || null,
            customer_phone: phone || null,
          };

          if (!payload.customer_id && !payload.customer_phone && !payload.customer_name) {
            console.warn("credit skipped: no customer info");
          } else {
            const { error: cErr } = await supabase.from("credits").insert(payload);
            if (cErr) {
              console.warn("credits insert failed (inventory saved anyway):", cErr);
            }
          }
        }
      }

      setSuccessMsg(
        paymentMethod === "credit"
          ? `Saved ${receiptId}. Order confirmed (#${String(orderId).slice(0, 8)}). Inventory + cost recorded. Credit recorded (if credits table exists).`
          : `Saved ${receiptId}. Order confirmed (#${String(orderId).slice(0, 8)}). Inventory + cost recorded.`
      );
    } catch (e: any) {
      try {
        console.error("FastSection submitSaleAsOrder error:", e);
        console.error("FastSection error keys:", e ? Object.getOwnPropertyNames(e) : []);
        console.error("FastSection error json:", (() => {
          try {
            const keys = e ? Object.getOwnPropertyNames(e) : [];
            const obj: any = {};
            for (const k of keys) obj[k] = e[k];
            return JSON.stringify(obj);
          } catch {
            return "<unstringifiable>";
          }
        })());
      } catch {}

      setErrorMsg(formatErr(e));
    } finally {
      setLoading(false);
    }
  }

return (
    <div className="max-w-full overflow-x-hidden text-gray-900">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Fast POS</h2>
          <p className="mt-2 text-sm text-gray-600">
            Quick in-store selling: capture customer + items, then save as an <b>order</b> and confirm it (writes inventory <b>sale</b> movements + cost).
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setErrorMsg(null);
            loadVariants()
              .catch((e) => {
                console.error("FastSection refresh variants error:", e);
                setErrorMsg(formatErr(e));
              })
              .finally(() => setLoading(false));
          }}
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 sm:w-auto"
        >
          {loading ? "Loading…" : "Refresh items"}
        </button>
      </div>

      {errorMsg && (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
      )}
      {successMsg && (
        <div className="mt-4 rounded-xl border border-green-300 bg-green-50 p-3 text-sm text-green-800">{successMsg}</div>
      )}

      <div className="mt-6 grid max-w-full gap-3 rounded-xl border p-4 lg:grid-cols-3">
        <div className="relative min-w-0">
          <label className="text-xs text-gray-600">Customer (name or number)</label>
          <input
            value={customerQuery}
            onChange={(e) => {
              setCustomerQuery(e.target.value);
              setSelectedCustomer(null);
            }}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            placeholder="Start typing…"
          />

          {customerQuery.trim().length >= 2 && customerSuggestions.length > 0 && !selectedCustomer && (
            <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
              {customerSuggestions.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedCustomer(c);
                    setCustomerQuery(`${c.name ?? ""}`.trim() || c.phone);
                    setCustomerPhone(c.phone);
                    setCustomerSuggestions([]);
                  }}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                >
                  <div className="truncate font-medium text-gray-900">{c.name ?? "(No name)"}</div>
                  <div className="text-xs text-gray-600">{c.phone}</div>
                </button>
              ))}
            </div>
          )}

          <div className="mt-2">
            <label className="text-xs text-gray-600">Customer phone (optional)</label>
            <input
              value={customerPhone}
              onChange={(e) => {
                setCustomerPhone(e.target.value);
                // if they manually edit phone, detach selected customer
                setSelectedCustomer(null);
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="e.g. +2526xxxxxxx"
            />
          </div>
        </div>

        <div className="lg:col-span-2">
          <label className="text-xs text-gray-600">Order note (optional)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            placeholder="e.g. delivery later / special request"
          />
          {selectedCustomer && (
            <div className="mt-2 text-xs text-gray-500">
              Selected: <b>{selectedCustomer.name ?? "(No name)"}</b> • {selectedCustomer.phone}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid max-w-full gap-3 rounded-xl border p-4 lg:grid-cols-5">
        <div className="relative min-w-0 lg:col-span-4">
          <label className="text-xs text-gray-600">Search item (variant name or SKU)</label>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              // if they start a new search, clear current selection
              if (e.target.value.trim().length >= 1) setSelectedVariantId("");
            }}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            placeholder="Type at least 2 characters…"
          />

          {q.trim().length >= 2 && (
            <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
              {(variantSuggestions.length > 0 ? variantSuggestions : filteredVariants)
                .slice(0, 20)
                .map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setSelectedVariantId(v.id);
                      setQ("");
                      setVariantSuggestions([]);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    <div className="truncate font-medium text-gray-900">{variantLabel(v)}</div>
                    <div className="mt-0.5 text-xs text-gray-600">
                      {String((v.variant_type ?? "").toLowerCase() === "weight" ? "Weight" : "Unit")}
                      {v.sell_price != null ? ` • $${Number(v.sell_price).toFixed(2)}` : ""}
                    </div>
                  </button>
                ))}

              {variantSuggestions.length === 0 && filteredVariants.length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-500">No matches.</div>
              )}
            </div>
          )}

          {selectedVariant && (
            <div className="mt-2 text-xs text-gray-500">
              Selected: <b>{variantLabel(selectedVariant)}</b>
            </div>
          )}
        </div>

        <div>
          <label className="text-xs text-gray-600">Qty</label>
          {selectedVariant && (selectedVariant.variant_type ?? "").toLowerCase() === "weight" ? (
            <input
              value={qtyKg}
              onChange={(e) => setQtyKg(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="0.250"
            />
          ) : (
            <input
              value={qtyUnits}
              onChange={(e) => setQtyUnits(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              placeholder="1"
            />
          )}
          <div className="mt-1 text-[11px] text-gray-500">
            {selectedVariant && (selectedVariant.variant_type ?? "").toLowerCase() === "weight" ? "kg (3 d.p)" : "units"}
          </div>
        </div>

        <div className="lg:col-span-5">
          <button
            type="button"
            onClick={addToCart}
            className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm text-white sm:w-auto"
          >
            Add item
          </button>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border">
        <div className="flex items-center justify-between gap-3 border-b bg-gray-50 px-4 py-3">
          <div className="text-sm font-semibold">Order items</div>
          <div className="text-sm text-gray-700">
            Est. total: <b>${totalEstimate.toFixed(2)}</b>
          </div>
        </div>

        <table className="min-w-full text-left text-sm">
          <thead className="bg-white text-xs text-gray-600">
            <tr>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Variant</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cart.map((c, idx) => (
              <tr key={`${c.variant_id}-${idx}`} className="border-t">
                <td className="px-3 py-2 text-xs text-gray-700"><div className="max-w-[220px] truncate">{c.product_name}</div></td>
                <td className="px-3 py-2 text-xs text-gray-700"><div className="max-w-[220px] truncate">{c.variant_name}</div></td>
                <td className="px-3 py-2 text-xs text-gray-700">
                  {c.variant_type === "weight" ? `${Number(c.qty_kg).toFixed(3)}kg` : `${toInt(c.qty_units)} units`}
                </td>
                <td className="px-3 py-2 text-xs text-gray-700">{c.unit_price ? `$${c.unit_price}` : ""}</td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}

            {cart.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-sm text-gray-500" colSpan={5}>
                  No items yet. Search and add variants above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex max-w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="min-w-[220px]">
          <label className="block text-xs text-gray-600">Payment</label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as any)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="cash">Cash</option>
            <option value="transfer">Transfer</option>
            <option value="credit">CREDIT (pay later)</option>
          </select>
          {paymentMethod === "credit" && (
            <div className="mt-1 text-[11px] text-gray-500">
              Choosing CREDIT will save inventory movement and also create a credit row.
            </div>
          )}
        </div>

        <button
          type="button"
          disabled={loading || cart.length === 0}
          onClick={submitSaleAsOrder}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {loading ? "Saving…" : "Save order (reduce inventory)"}
        </button>

        <button
          type="button"
          disabled={loading || cart.length === 0}
          onClick={() => {
            if (confirm("Clear this order?")) setCart([]);
          }}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-60"
        >
          Clear
        </button>

        <div className="text-xs text-gray-500">
          Fast POS creates an <b>order</b> (channel: <b>pos</b>) then runs <b>confirm_order()</b> to reduce inventory and record cost.
        </div>
      </div>
    </div>
  );
}