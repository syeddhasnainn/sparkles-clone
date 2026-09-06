import { useAccount } from "@/hooks/use-account";

export function AccountAvatar({ size = "small" }: { size?: "small" | "large" }) {
  const user = useAccount();
  return (
    <span className={`account-avatar ${size}`} role="img" aria-label={user.name}>
      {user.imageUrl ? <img src={user.imageUrl} alt="" /> : user.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
