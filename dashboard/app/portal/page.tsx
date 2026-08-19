import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

/**
 * The portal root is no longer a page of its own: investors have /account and staff have
 * /portal/admin. Kept as a redirect so existing links and the console's nav still land somewhere
 * sensible for whoever is signed in.
 */
export const dynamic = "force-dynamic";

export default async function PortalIndex() {
  const user = await currentUser();
  if (!user) redirect("/login");
  redirect(user.role === "admin" ? "/portal/admin" : "/account");
}
