import React, { useState, useEffect } from "react";
import { getSupabase } from "@/lib/supabaseClient";

export default function CategoriesSection() {
  const [categories, setCategories] = useState([]);
  const supabase = getSupabase();

  useEffect(() => {
    async function fetchCategories() {
      const { data, error } = await supabase.from("categories").select("*");
      if (!error) {
        setCategories(data);
      }
    }
    fetchCategories();
  }, [supabase]);

  return (
    <section>
      <h2>Categories</h2>
      <ul>
        {categories.map((category) => (
          <li key={category.id}>{category.name}</li>
        ))}
      </ul>
    </section>
  );
}