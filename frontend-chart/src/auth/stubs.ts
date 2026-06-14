export interface AuthUser {
  name: string;
  email: string;
  avatar: string;
}

export function getCurrentUser(): AuthUser | null {
  const raw = localStorage.getItem("procluster_user");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      name: parsed.name || "User",
      email: parsed.email || "",
      avatar: parsed.avatar || ""
    };
  } catch {
    return null;
  }
}

export function seedAdminAccount(): void {}

export function loginUser(
  name: string,
  password: string,
  _langTexts?: any
): { success: boolean; error?: string; user?: AuthUser } {
  if (!name || !password)
    return { success: false, error: "Fill all fields" };
  const user: AuthUser = {
    name,
    email: `${name}@procluster.local`,
    avatar: ""
  };
  localStorage.setItem(
    "procluster_user",
    JSON.stringify({
      ...user,
      tier: "Admin",
      role: "Admin",
      subscriptionLevel: "Admin"
    })
  );
  return { success: true, user };
}

export function registerUser(
  name: string,
  email: string,
  password: string,
  confirm: string,
  _langTexts?: any
): { success: boolean; error?: string; user?: AuthUser } {
  if (password !== confirm)
    return { success: false, error: "Passwords don't match" };
  const user: AuthUser = { name, email, avatar: "" };
  localStorage.setItem(
    "procluster_user",
    JSON.stringify({
      ...user,
      tier: "Free",
      role: "Free",
      subscriptionLevel: "Free"
    })
  );
  return { success: true, user };
}

export function authenticateWithGoogle(): AuthUser {
  const user: AuthUser = {
    name: "User",
    email: "user@gmail.com",
    avatar: ""
  };
  localStorage.setItem(
    "procluster_user",
    JSON.stringify({ ...user, tier: "Free", role: "Free" })
  );
  return user;
}

export function authenticateWithAdmin(): AuthUser {
  const user: AuthUser = {
    name: "Admin",
    email: "admin@procluster.io",
    avatar: ""
  };
  localStorage.setItem(
    "procluster_user",
    JSON.stringify({
      ...user,
      tier: "Admin",
      role: "Admin",
      subscriptionLevel: "Admin"
    })
  );
  return user;
}

export function logoutUser(): void {
  localStorage.removeItem("procluster_user");
}
