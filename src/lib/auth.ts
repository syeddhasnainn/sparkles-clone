import { createServerFn } from "@tanstack/react-start";
import { getAuth } from "@workos/authkit-tanstack-react-start";

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  const { user } = await getAuth();
  if (!user) return null;
  return {
    id: user.id,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
    email: user.email,
    imageUrl: user.profilePictureUrl,
  };
});
