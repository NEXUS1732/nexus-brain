
export interface Env {
  DB: D1Database;
  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  EXA_API_KEY: string;
  OPENROUTER_API_KEY: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
