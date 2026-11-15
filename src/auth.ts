import { Env } from "./types";

const ITERATIONS = 310000;
const SESSION_DAYS = 30;

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(value: string): Uint8Array {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}
async function passwordHash(password: string, salt: Uint8Array, iterations = ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return b64url(new Uint8Array(bits));
}
function response(data: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
async function issueSession(env: Env, userId: string): Promise<string> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO nexus_auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await digest(token), userId, new Date(Date.now() + SESSION_DAYS * 86400000).toISOString()).run();
  return token;
}

export async function authenticateNexusSession(request: Request, env: Env): Promise<string | null> {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    const row = await env.DB.prepare("SELECT user_id FROM nexus_auth_sessions WHERE token_hash = ? AND expires_at > ?")
      .bind(await digest(token), new Date().toISOString()).first<{ user_id: string }>();
    return row?.user_id || null;
  } catch {
    return null;
  }
}

export async function handleAuthRequest(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405, cors);
  if (path === "/api/auth/logout") {
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\\s+/, "").trim();
    if (token) await env.DB.prepare("DELETE FROM nexus_auth_sessions WHERE token_hash = ?").bind(await digest(token)).run();
    return response({ ok: true }, 200, cors);
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return response({ error: "Invalid request." }, 400, cors); }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username) || password.length < 10 || password.length > 128) {
    return response({ error: "Use a 3–24 character username (letters, numbers or _) and a password of at least 10 characters." }, 400, cors);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const attemptKey = await digest(ip + "|" + username.toLowerCase());
  const now = Math.floor(Date.now() / 1000);
  const attempts = await env.DB.prepare("SELECT window_started_at, attempts FROM nexus_auth_attempts WHERE attempt_key = ?")
    .bind(attemptKey).first<{ window_started_at: number; attempts: number }>();
  if (attempts && now - attempts.window_started_at < 900 && attempts.attempts >= 8) {
    return response({ error: "Too many attempts. Please wait 15 minutes and try again." }, 429, cors);
  }
  if (!attempts || now - attempts.window_started_at >= 900) {
    await env.DB.prepare("INSERT OR REPLACE INTO nexus_auth_attempts (attempt_key, window_started_at, attempts) VALUES (?, ?, 1)").bind(attemptKey, now).run();
  } else {
    await env.DB.prepare("UPDATE nexus_auth_attempts SET attempts = attempts + 1 WHERE attempt_key = ?").bind(attemptKey).run();
  }

  if (path === "/api/auth/logout") {
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/, "").trim();
    if (token) await env.DB.prepare("DELETE FROM nexus_auth_sessions WHERE token_hash = ?").bind(await digest(token)).run();
    return response({ ok: true }, 200, cors);
  }

  if (path === "/api/auth/register") {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const id = crypto.randomUUID();
    const hash = await passwordHash(password, salt);
    try {
      await env.DB.prepare("INSERT INTO nexus_auth_users (user_id, username, password_salt, password_hash, password_iterations) VALUES (?, ?, ?, ?, ?)")
        .bind(id, username, b64url(salt), hash, ITERATIONS).run();
    } catch {
      return response({ error: "That username is unavailable." }, 409, cors);
    }
    const token = await issueSession(env, id);
    return response({ token, user: { id, username } }, 201, cors);
  }

  if (path === "/api/auth/login") {
    const user = await env.DB.prepare("SELECT user_id, username, password_salt, password_hash, password_iterations FROM nexus_auth_users WHERE username = ? COLLATE NOCASE")
      .bind(username).first<{ user_id: string; username: string; password_salt: string; password_hash: string; password_iterations: number }>();
    if (!user) return response({ error: "Username or password is incorrect." }, 401, cors);
    const calculated = await passwordHash(password, fromB64url(user.password_salt), user.password_iterations);
    let mismatch = calculated.length ^ user.password_hash.length;
    for (let i = 0; i < Math.max(calculated.length, user.password_hash.length); i++) {
      mismatch |= (calculated.charCodeAt(i) || 0) ^ (user.password_hash.charCodeAt(i) || 0);
    }
    if (mismatch !== 0) return response({ error: "Username or password is incorrect." }, 401, cors);
    const token = await issueSession(env, user.user_id);
    return response({ token, user: { id: user.user_id, username: user.username } }, 200, cors);
  }

  if (path === "/api/auth/migrate") {
    const authorization = request.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return response({ error: "Sign in to your existing account first." }, 401, cors);
    let legacyId: string | null = null;
    try {
      const verified = await fetch(env.SUPABASE_URL.replace(/\/+$/, "") + "/auth/v1/user", {
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: authorization },
      });
      if (verified.ok) {
        const legacy = await verified.json() as { id?: unknown };
        if (typeof legacy.id === "string") legacyId = legacy.id;
      }
    } catch { /* handled by generic response */ }
    if (!legacyId) return response({ error: "Your existing account could not be verified. Please sign in again." }, 401, cors);
    const existing = await env.DB.prepare("SELECT user_id FROM nexus_auth_users WHERE legacy_supabase_id = ? OR user_id = ?")
      .bind(legacyId, legacyId).first();
    if (existing) return response({ error: "This account has already been migrated." }, 409, cors);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await passwordHash(password, salt);
    try {
      await env.DB.prepare("INSERT INTO nexus_auth_users (user_id, username, password_salt, password_hash, password_iterations, legacy_supabase_id) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(legacyId, username, b64url(salt), hash, ITERATIONS, legacyId).run();
    } catch {
      return response({ error: "That username is unavailable, or this account has already been migrated." }, 409, cors);
    }
    const token = await issueSession(env, legacyId);
    return response({ token, user: { id: legacyId, username } }, 200, cors);
  }

  return response({ error: "Not found." }, 404, cors);
}
