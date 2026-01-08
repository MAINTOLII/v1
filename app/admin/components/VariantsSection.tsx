"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

function formatErr(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e?.message) {
    const parts: string[] = [String(e.message)];
    if (e?.code) parts.push(`code=${e.code}`);
    if (e?.details) parts.push(`details=${e.details}`);
    if (e?.hint) parts.push(`hint=${e.hint}`);
    return parts.join(" • ");
  }
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

type Product = {
  id: string;
  name: string;
};

type VariantImage = {
  id?: string;
  variant_id: string;
  url: string;
  is_primary?: boolean;
  created_at?: string;
  // NOTE: we still use a Storage path internally when uploading, but we don't require a DB column for it.
  path?: string;
};

type Variant = {
  id: string;
  product_id: string;
  name: string;
  variant_type: string;
  pack_size_g: number | null;
  sell_price: number | null;
  sku: string | null;
  is_active: boolean;
  product?: { name: string } | null;
  images?: VariantImage[];
};

function asOne<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function displayName(row: any): string {
  return String(row?.name ?? "");
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

const VARIANT_IMAGES_BUCKET = "images"; // bucket name

function safeFileExt(name: string) {
  const parts = (name || "").split(".");
  const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "jpg";
  return ext.replace(/[^a-z0-9]/g, "").slice(0, 8) || "jpg";
}

function isImageFile(file: File) {
  return file && file.type && file.type.startsWith("image/");
}

async function uploadVariantImage(variantId: string, file: File) {
  if (!file) throw new Error("No file selected");
  if (!isImageFile(file)) throw new Error("Please select an image file");

  const ext = safeFileExt(file.name);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `variants/${variantId}/${stamp}.${ext}`;

  // 1) Upload to Storage
  const { data: upData, error: upErr } = await supabase.storage
    .from(VARIANT_IMAGES_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });

  if (upErr) {
    // Supabase errors sometimes don't JSON stringify well; log key fields explicitly.
    console.error("[Storage upload blocked]", {
      bucket: VARIANT_IMAGES_BUCKET,
      path,
      message: (upErr as any)?.message,
      name: (upErr as any)?.name,
      status: (upErr as any)?.status,
      error: upErr,
    });
    throw new Error(`Storage upload failed: ${formatErr(upErr)}`);
  }

  // 2) Build a public URL (bucket should be PUBLIC)
  const { data: pub } = supabase.storage.from(VARIANT_IMAGES_BUCKET).getPublicUrl(path);
  const url = pub?.publicUrl;
  if (!url) throw new Error("Could not get public URL for uploaded image");

  // 3) Save reference in DB (table: public.product_variant_images)
  const { data: ins, error: insErr } = await supabase
    .from("product_variant_images")
    .insert({ variant_id: variantId, url, is_primary: true })
    .select("id,variant_id,url,is_primary,created_at")
    .single();

  if (insErr) {
    console.error("[DB insert blocked]", { table: "product_variant_images", payload: { variant_id: variantId, url }, insErr });
    // Note: the file may already be uploaded even if DB insert fails.
    throw new Error(`DB insert failed: ${formatErr(insErr)}`);
  }

  // Attach storage path locally (optional)
  const out: VariantImage = { ...(ins as any), path };
  return out;
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

  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [uploadingVariantId, setUploadingVariantId] = useState<string | null>(null);

  async function loadProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("id,name")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      console.error(error);
      setErrorMsg(error.message);
      return;
    }

    const normalized: Product[] = (data || []).map((row: any) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
    }));
    setProducts(normalized);
  }

  async function loadVariants() {
    const { data, error } = await supabase
      .from("product_variants")
      .select(
        "id,product_id,name,variant_type,pack_size_g,sell_price,sku,is_active,created_at,product:products(name),images:product_variant_images(id,variant_id,url,is_primary,created_at)"
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setErrorMsg(error.message);
      return;
    }

    const normalized: Variant[] = (data || []).map((row: any) => {
      const product = asOne<any>(row.product);
      return {
        id: String(row.id),
        product_id: String(row.product_id),
        name: String(row.name),
        variant_type: String(row.variant_type),
        pack_size_g: row.pack_size_g ?? null,
        sell_price: row.sell_price === null || row.sell_price === undefined ? null : Number(row.sell_price),
        sku: row.sku ?? null,
        is_active: !!row.is_active,
        product: product ? { name: String(product.name ?? "") } : null,
        images: Array.isArray(row.images)
          ? row.images
              .map((im: any) => ({
                id: im.id ? String(im.id) : undefined,
                variant_id: String(im.variant_id ?? row.id),
                url: String(im.url ?? ""),
                is_primary: im.is_primary === undefined ? undefined : !!im.is_primary,
                created_at: im.created_at,
              }))
              .filter((im: any) => im.url)
          : [],
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

    const cleanName = name.trim();
    const cleanVariantType = String(variantType || "").trim();
    const cleanPackG = cleanVariantType === "weight" ? kgToG(packSizeKg) : null;

    // Prevent duplicate variants for same product
    const dup = variants.some((v) => {
      if (v.product_id !== productId) return false;
      if (String(v.variant_type) !== cleanVariantType) return false;
      const a = String(v.name || "").trim().toLowerCase();
      const b = String(cleanName).trim().toLowerCase();
      if (a !== b) return false;
      const vg = v.pack_size_g ?? null;
      if (cleanVariantType === "weight") return (vg ?? null) === (cleanPackG ?? null);
      // unit variants: pack_size_g should both be null
      return (vg ?? null) === null;
    });

    if (dup) {
      setErrorMsg("Duplicate variant: this product already has the same variant name/type (and pack size). ");
      return;
    }

    const payload = {
      product_id: productId,
      name: cleanName,
      variant_type: cleanVariantType,
      pack_size_g: cleanPackG,
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

    // Optional: upload image to Storage and save reference
    if (newImageFile) {
      try {
        setUploadingVariantId(String((data as any).id));
        const imgRow = await uploadVariantImage(String((data as any).id), newImageFile);
        // attach locally
        (data as any).images = [imgRow];
      } catch (imgErr: any) {
        console.error("Variant image upload failed:", imgErr);
        setErrorMsg(String(imgErr?.message || formatErr(imgErr)));
      } finally {
        setUploadingVariantId(null);
      }
    }

    const productRow = products.find((p) => p.id === productId);
    const productName = productRow ? displayName(productRow) : "";
    setVariants((prev) => [
      {
        id: String((data as any).id),
        product_id: String((data as any).product_id),
        name: String((data as any).name),
        variant_type: String((data as any).variant_type),
        pack_size_g: (data as any).pack_size_g ?? null,
        sell_price:
          (data as any).sell_price === null || (data as any).sell_price === undefined
            ? null
            : Number((data as any).sell_price),
        sku: (data as any).sku ?? null,
        is_active: !!(data as any).is_active,
        images: Array.isArray((data as any).images) ? (data as any).images : [],
        product: productRow ? { name: String(productRow.name ?? "") } : null,
      },
      ...prev,
    ]);
    setName("");
    setPackSizeKg("");
    setPrice("");
    setNewImageFile(null);
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
                {displayName(p)}
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

          <div className="md:col-span-2">
            <label className="mb-1 block text-xs text-gray-600">Variant image (optional)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const el = e.currentTarget;
                const f = el.files?.[0] ?? null;
                setNewImageFile(f);
                // Reset so picking the same file again triggers change
                try {
                  if (el && el.isConnected) el.value = "";
                } catch {
                  // ignore
                }
              }}
              className="w-full rounded border bg-white px-3 py-2 text-sm"
            />
            <div className="mt-1 text-xs text-gray-500">
              Uploads to Storage bucket <code>images</code> under <code>variants/</code>.
            </div>
          </div>

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
          disabled={uploadingVariantId === "new" || !productId || !name.trim() || !price}
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
              <div className="flex gap-3">
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded border bg-gray-50">
                  {v.images && v.images[0]?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.images[0].url} alt={v.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">
                      No image
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-xs text-gray-500">{displayName(v.product)}</div>
                  <div className="font-medium truncate">{v.name}</div>
                  <div className="text-xs text-gray-500">
                    {v.variant_type}
                    {v.pack_size_g ? ` • ${gToKgLabel(v.pack_size_g)}` : ""} • ${v.sell_price ?? 0}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="text-xs text-gray-600">Update image:</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const inputEl = e.currentTarget;
                        const f = inputEl?.files?.[0] ?? null;

                        // Reset ASAP, but guard against the input being detached/unmounted
                        try {
                          if (inputEl && inputEl.isConnected) inputEl.value = "";
                        } catch {
                          // ignore
                        }

                        if (!f) return;
                        setErrorMsg(null);

                        try {
                          setUploadingVariantId(v.id);
                          const imgRow = await uploadVariantImage(v.id, f);

                          setVariants((prev) =>
                            prev.map((x) => (x.id === v.id ? { ...x, images: [imgRow, ...(x.images ?? [])] } : x))
                          );
                        } catch (imgErr: any) {
                          console.error("Variant image upload failed:", imgErr);
                          setErrorMsg(String(imgErr?.message || formatErr(imgErr)));
                        } finally {
                          setUploadingVariantId(null);
                        }
                      }}
                      className="text-xs"
                    />
                    {uploadingVariantId === v.id && (
                      <span className="text-xs text-gray-500">Uploading…</span>
                    )}
                  </div>
                </div>
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
