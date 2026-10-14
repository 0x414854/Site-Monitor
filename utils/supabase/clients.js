import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseSecret) {
  throw new Error("Configuration serveur Supabase manquante.");
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseSecret, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
