
export interface Env {
  AI: Ai;
  DB: D1Database;
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
