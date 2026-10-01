export type VotechainRole = "ADMIN" | "VOTER" | "OBSERVER" | "AUTHORITY";

export function getRoleLandingRoute(role: VotechainRole): string {
  switch (role) {
    case "ADMIN":
      return "/";
    case "OBSERVER":
      return "/observer";
    case "AUTHORITY":
      return "/authority";
    case "VOTER":
    default:
      return "/portal";
  }
}
