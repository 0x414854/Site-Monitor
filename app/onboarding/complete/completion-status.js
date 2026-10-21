"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../onboarding.module.css";

export default function CompletionStatus() {
  const router = useRouter();
  const [status, setStatus] = useState("checking");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let active = true;
    let timer;

    async function checkStatus() {
      try {
        const response = await fetch("/api/onboarding/status", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("État du paiement indisponible.");
        const result = await response.json();
        if (!active) return;

        if (result.complete) {
          setStatus("complete");
          timer = window.setTimeout(() => router.replace("/dashboard"), 1500);
          return;
        }

        setStatus("pending");
        timer = window.setTimeout(() => {
          setElapsed((value) => value + 3);
          checkStatus();
        }, 3000);
      } catch {
        if (!active) return;
        setStatus("unavailable");
        timer = window.setTimeout(checkStatus, 5000);
      }
    }

    checkStatus();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [router]);

  return (
    <div className={styles.statusBox} role="status" aria-live="polite">
      {status === "complete" ? (
        <p className={styles.success}>
          Paiement confirmé. Redirection vers ton tableau de bord…
        </p>
      ) : status === "unavailable" ? (
        <p className={styles.notice}>
          La vérification est momentanément indisponible. Nous réessayons
          automatiquement.
        </p>
      ) : (
        <>
          <p className={styles.notice}>
            Confirmation du paiement… {elapsed > 0 ? `${elapsed} s écoulées.` : ""}
          </p>
          {elapsed >= 60 && (
            <p className={styles.footerNote}>
              La confirmation prend plus de temps que prévu. Tu peux{" "}
              <a href="/dashboard">ouvrir ton tableau de bord</a>; ton forfait
              sera activé dès la confirmation de Stripe.
            </p>
          )}
        </>
      )}
    </div>
  );
}
