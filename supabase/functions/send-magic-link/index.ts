import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePath(path: string) {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function parseAllowedPaths(raw: string | undefined) {
  const parsed = (raw || "")
    .split(",")
    .map((v) => normalizePath(v.trim()))
    .filter((v) => v.length > 1);

  if (!parsed.includes("/sync-resolve")) parsed.push("/sync-resolve");
  return parsed;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const emailRaw = typeof body.email === "string" ? body.email : "";
    const email = emailRaw.trim().toLowerCase();

    if (!email) {
      return jsonResponse(400, { error: "Email is required" });
    }
    if (!isValidEmail(email)) {
      return jsonResponse(400, { error: "Invalid email format" });
    }

    const requestedPath =
      typeof body.redirectPath === "string" && body.redirectPath.trim()
        ? normalizePath(body.redirectPath.trim())
        : "/sync-resolve";

    const allowedPaths = parseAllowedPaths(Deno.env.get("MAGIC_LINK_ALLOWED_PATHS"));
    const resolvedPath = allowedPaths.includes(requestedPath)
      ? requestedPath
      : "/sync-resolve";

    const siteUrl = (Deno.env.get("MAGIC_LINK_SITE_URL") || "https://left-wordle.com").replace(/\/+$/, "");
    const redirectTo = `${siteUrl}${resolvedPath}`;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(500, { error: "Server auth configuration is missing" });
    }

    const postmarkToken = Deno.env.get("POSTMARK_SERVER_TOKEN");
    if (!postmarkToken) {
      return jsonResponse(500, { error: "POSTMARK_SERVER_TOKEN is not configured" });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: {
        redirectTo,
      },
    });

    if (error) {
      return jsonResponse(400, { error: error.message });
    }

    const userId = data?.user?.id;
    if (userId) {
      const { error: profileError } = await supabaseAdmin.from("profiles").upsert(
        {
          user_id: userId,
          preferences: {},
          legacy_stats: {},
          preferences_updated_at: null,
          legacy_updated_at: null,
        },
        { onConflict: "user_id" },
      );

      if (profileError) {
        // Do not fail magic-link delivery if profile bootstrap fails.
        console.warn("profiles upsert warning", profileError.message);
      }
    }

    const actionLink = data?.properties?.action_link;
    if (!actionLink) {
      return jsonResponse(500, { error: "Generated link is missing" });
    }

    const templateAlias = Deno.env.get("POSTMARK_TEMPLATE_ALIAS") || "magic-link";
    const fromAddress = Deno.env.get("POSTMARK_FROM_EMAIL") || "no-reply@left-wordle.com";

    const postmarkResponse = await fetch("https://api.postmarkapp.com/email/withTemplate", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": postmarkToken,
      },
      body: JSON.stringify({
        From: fromAddress,
        To: email,
        TemplateAlias: templateAlias,
        TemplateModel: {
          magic_link: actionLink,
          email,
          redirect_to: redirectTo,
        },
      }),
    });

    if (!postmarkResponse.ok) {
      const postmarkError = await postmarkResponse.text();
      console.error("postmark error", postmarkError);
      return jsonResponse(502, { error: "Failed to send email" });
    }

    return jsonResponse(200, { success: true });
  } catch (error) {
    console.error("send-magic-link function error", error);
    return jsonResponse(500, { error: "Internal server error" });
  }
});
