"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Product = {
  id: string;
  name: string;
};

type Variant = {
  id: string;
  product_id: string;
  name: string;
  variant_type: string;
  pack_size_g: number | null;
  sell_price: number;
  sku: string | null;
  is_active: boolean;
  product?: { name: string } | null;
};

function asOne<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function kgToG(inputKg: string) {
  const n = Number(inputKg);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000);
}

function gToKgLabel(g?: number | null) {
  const n = Number(g ?? 0);
  if (!Number.isFinite(n) || n === 0) return "";
  return `${(n / 1000).toFixed(3)}kg`;
}

export default function VariantsSection() {
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [variantType, setVariantType] = useState("unit"); // unit | weight
  const [packSizeKg, setPackSizeKg] = useState("");
  const [price, setPrice] = useState("");

  async function loadProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("id,name")
      .eq("is_active", true)
      .order("name");

    if (error) {
      console.error(error);
      setErrorMsg(error.message);
      return;
    }

    setProducts(data || []);
  }

  async function loadVariants() {
    const { data, error } = await supabase
      .from("product_variants")
      .select("id,product_id,name,variant_type,pack_size_g,sell_price,sku,is_active,created_at,product:products(name)")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setErrorMsg(error.message);
      return;
    }

    const normalized: Variant[] = (data || []).map((row: any) => {
      const product = asOne<{ name: any }>(row.product);
      return {
        id: String(row.id),
        product_id: String(row.product_id),
        name: String(row.name),
        variant_type: String(row.variant_type),
        pack_size_g: row.pack_size_g ?? null,
        sell_price: Number(row.sell_price ?? 0),
        sku: row.sku ?? null,
        is_active: !!row.is_active,
        product: product ? { name: String(product.name) } : null,
      };
    });

    setVariants(normalized);
  }

  useEffect(() => {
    loadProducts();
    loadVariants();
  }, []);

  async function addVariant() {
    setErrorMsg(null);

    if (!productId || !name || !price) {
      setErrorMsg("Product, name and price are required.");
      return;
    }

    const payload = {
      product_id: productId,
      name,
      variant_type: variantType,
      pack_size_g: variantType === "weight" ? kgToG(packSizeKg) : null,
      sell_price: Number(price),
      is_active: true,
    };

    const { data, error } = await supabase
      .from("product_variants")
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error(error);
      setErrorMsg(error.message);
      return;
    }

    const productName = products.find((p) => p.id === productId)?.name;
    setVariants((prev) => [
      {
        id: String((data as any).id),
        product_id: String((data as any).product_id),
        name: String((data as any).name),
        variant_type: String((data as any).variant_type),
        pack_size_g: (data as any).pack_size_g ?? null,
        sell_price: Number((data as any).sell_price ?? 0),
        sku: (data as any).sku ?? null,
        is_active: !!(data as any).is_active,
        product: productName ? { name: productName } : null,
      },
      ...prev,
    ]);
    setName("");
    setPackSizeKg("");
    setPrice("");
  }

  return (
    <div className="text-gray-900">
      <h2 className="text-lg font-semibold">Variants</h2>
      <p className="mt-2 text-sm text-gray-600">
        Simple product variants (pack size or unit).
      </p>

      {errorMsg && (
        <div className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {errorMsg}
        </div>
      )}

      {/* Add variant */}
      <div className="mt-6 rounded border p-4">
        <div className="grid gap-4 md:grid-cols-2">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="rounded border px-3 py-2"
          >
            <option value="">Select product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Variant name (e.g. 500g pack)"
            className="rounded border px-3 py-2"
          />

          <select
            value={variantType}
            onChange={(e) => setVariantType(e.target.value)}
            className="rounded border px-3 py-2"
          >
            <option value="unit">Unit</option>
            <option value="weight">Weight</option>
          </select>

          {variantType === "weight" && (
            <input
              value={packSizeKg}
              onChange={(e) => setPackSizeKg(e.target.value)}
              inputMode="decimal"
              step="0.001"
              placeholder="Pack size (kg) e.g. 0.500"
              className="rounded border px-3 py-2"
            />
          )}

          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Sell price"
            className="rounded border px-3 py-2"
          />
        </div>

        <button
          onClick={addVariant}
          className="mt-4 rounded bg-gray-900 px-4 py-2 text-sm text-white"
        >
          Add Variant
        </button>
      </div>

      {/* Variant list */}
      <div className="mt-6">
        <h3 className="text-sm font-medium">Existing variants</h3>
        <ul className="mt-3 space-y-2">
          {variants.map((v) => (
            <li key={v.id} className="rounded border px-3 py-2 text-sm">
              <div className="text-xs text-gray-500">{v.product?.name ?? ""}</div>
              <div className="font-medium">{v.name}</div>
              <div className="text-xs text-gray-500">
                {v.variant_type}
                {v.pack_size_g ? ` • ${gToKgLabel(v.pack_size_g)}` : ""} • ${v.sell_price}
              </div>
            </li>
          ))}
          {variants.length === 0 && (
            <li className="text-sm text-gray-500">No variants yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
