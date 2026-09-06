export function AccountAvatar({ size = "small" }: { size?: "small" | "large" }) {
  return (
    <span className={`account-avatar ${size}`} role="img" aria-label="Account">
      A
    </span>
  );
}
