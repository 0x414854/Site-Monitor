import { signOut } from "@/app/actions/auth";
import styles from "@/styles/components/dashboard/signOutButton.module.css";

export default function SignOutButton({ email }) {
  return (
    <form action={signOut} className={styles.form}>
      <span className={styles.email}>{email}</span>
      <button type="submit" className={styles.button}>
        Se déconnecter
      </button>
    </form>
  );
}
