
import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

const SYSTEM_PROMPT =
  "You are NEXUS, a helpful, friendly AI assistant. Be concise, accurate and practical. Never claim to have performed an action unless it has actually been completed. Always request explicit approval before consequential external actions.";

const MAIN_DOMAIN = "nexus-assistant-cb8.pages.dev";
const BACKEND_DOMAIN = "nexus-brain.markmartin1732.workers.dev";

function isAllowedOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);

    return (
      parsed.protocol === "https:" &&
      (
        parsed.hostname === MAIN_DOMAIN ||
        parsed.hostname.endsWith("." + MAIN_DOMAIN) ||
        parsed.hostname === BACKEND_DOMAIN
      )
    );
  } catch {
    return false;
  }
}

function isAuthorized(request: Request, env: Env): boolean {
  const suppliedKey = request.headers.get("X-NEXUS-KEY");

  return Boolean(
    suppliedKey &&
    suppliedKey === env.NEXUS_ACCESS_KEY
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (origin && !isAllowedOrigin(origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }

    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-NEXUS-KEY",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    if (origin) {
      corsHeaders["Access-Control-Allow-Origin"] = origin;
    }

    if (url.pathname === "/api/chat") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      if (request.method === "POST") {
        if (!isAuthorized(request, env)) {
          return new Response("Unauthorized", {
            status: 401,
            headers: corsHeaders,
          });
        }

        return handleChatRequest(request, env, corsHeaders);
      }

      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleChatRequest(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  try {
    const body = (await request.json()) as {
      messages?: unknown;
    };

    if (!Array.isArray(body.messages)) {
      return new Response("Invalid messages", {
        status: 400,
        headers: corsHeaders,
      });
    }

    const safeMessages: ChatMessage[] = body.messages
      .filter((message): message is ChatMessage => {
        if (!message || typeof message !== "object") {
          return false;
        }

        const item = message as Record<string, unknown>;

        return (
          (item.role === "user" || item.role === "assistant") &&
          typeof item.content === "string"
        );
      })
      .slice(-30)
      .map((message) => ({
        role: message.role,
        content: message.content.slice(0, 8000),
      }));

    const inputs = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...safeMessages,
      ],
      max_tokens: 1024,
      stream: true,
    } satisfies AiTextGenerationInput & { stream: true };

    const stream = await env.AI.run<typeof MODEL_ID>(
      MODEL_ID,
      inputs,
    );

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });

  } catch (error) {
    console.error("NEXUS chat error:", error);

    return new Response(
      JSON.stringify({ error: "Failed to process request" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
}
