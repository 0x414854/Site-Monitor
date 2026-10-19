import { redirect } from "next/navigation";
import AuthForm from "./auth-form";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  const params = await searchParams;

  return <AuthForm initialError={params?.error ?? null} />;
}
