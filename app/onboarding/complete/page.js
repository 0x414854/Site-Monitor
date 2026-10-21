import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import CompletionStatus from "./completion-status";
import styles from "../onboarding.module.css";

export const dynamic = "force-dynamic";

export default async function OnboardingCompletePage() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");

  return (
    <main className={styles.page}>
      <section className={styles.container}>
        <span className={styles.eyebrow}>PAIEMENT EN COURS DE VALIDATION</span>
        <h1>Merci pour ton inscription</h1>
        <p className={styles.intro}>
          Stripe confirme le paiement de manière sécurisée. Cette étape peut
          prendre quelques instants; ne relance pas le paiement.
        </p>
        <CompletionStatus />
      </section>
    </main>
  );
}
