import { signOutCurrentUser } from "@/app/actions/participant.actions";

/** Ends the session from any signed-in page; sits at the end of the page nav. */
export default function SignOutButton() {
  return <form action={signOutCurrentUser} className="nav-signout">
    <button type="submit" className="link-button">Sign out</button>
  </form>;
}
