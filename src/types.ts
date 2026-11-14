
/**
 * Type definitions for the NEXUS AI application.
 */

export interface Env {
  AI: Ai;

  ASSETS: {
    fetch: (request: Request) => Promise<Response>;
  };

  NEXUS_ACCESS_KEY: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
