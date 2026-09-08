// O'live 연습 링크용 YouTube 검색 프록시.
//
// 브라우저가 Google API를 직접 호출하지 않는다. 그래야 API 키가 사용자에게
// 노출되지 않고, 앱 CSP의 connect-src를 Supabase로만 유지할 수 있다.
//
// YOUTUBE_DATA_API_KEY는 Supabase secret으로만 넣는다. 저장소나 클라이언트
// 코드에 실제 키 값을 두지 않는다.
//
//   supabase secrets set YOUTUBE_DATA_API_KEY=...
//   supabase functions deploy youtube-search

import { createClient } from "npm:@supabase/supabase-js@2.110.8";

const allowedOrigins = new Set([
  "https://olivemusic.github.io",
  "http://127.0.0.1:8765",
  "http://localhost:8765",
]);

const MAX_RESULTS = 6;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const UPSTREAM_TIMEOUT_MS = 8000;

function corsHeaders(request: Request) {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "https://olivemusic.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function fail(headers: HeadersInit, status: number, code: string) {
  return new Response(JSON.stringify({ error: code }), { status, headers });
}

// 제어문자만 걷어낸다. 한글·일본어·기호가 든 곡명을 막지 않는다.
function normalizeQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

Deno.serve(async (request) => {
  const headers = corsHeaders(request);

  if (request.method === "OPTIONS") {
    const origin = request.headers.get("Origin") ?? "";
    if (!allowedOrigins.has(origin)) {
      return new Response(null, { status: 403, headers });
    }
    return new Response("ok", { headers });
  }
  if (request.method !== "POST") {
    return fail(headers, 405, "method_not_allowed");
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return fail(headers, 401, "auth_required");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SB_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const youtubeKey = Deno.env.get("YOUTUBE_DATA_API_KEY");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return fail(headers, 500, "server_misconfigured");
  }
  if (!youtubeKey) {
    // 키를 아직 넣지 않은 상태. 앱은 이 코드를 보고 URL 붙여넣기를 안내한다.
    return fail(headers, 503, "search_unavailable");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail(headers, 400, "invalid_request");
  }
  const query = normalizeQuery((payload as { query?: unknown } | null)?.query);
  if (query.length < MIN_QUERY_LENGTH) return fail(headers, 400, "query_too_short");
  if (query.length > MAX_QUERY_LENGTH) return fail(headers, 400, "query_too_long");

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return fail(headers, 401, "invalid_session");
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: quota, error: quotaError } = await adminClient.rpc(
    "consume_youtube_search_quota",
    { p_user_id: user.id },
  );
  if (quotaError) {
    return fail(headers, 500, "quota_check_failed");
  }
  if (!quota?.allowed) {
    return fail(headers, 429, quota?.reason === "user" ? "rate_limited" : "quota_exhausted");
  }

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
  endpoint.searchParams.set("part", "snippet");
  endpoint.searchParams.set("type", "video");
  endpoint.searchParams.set("videoEmbeddable", "true");
  endpoint.searchParams.set("videoSyndicated", "true");
  endpoint.searchParams.set("maxResults", String(MAX_RESULTS));
  endpoint.searchParams.set("safeSearch", "none");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("key", youtubeKey);

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return fail(headers, 504, "upstream_timeout");
  }

  if (!upstream.ok) {
    // Google의 원문 오류는 키 정보를 담을 수 있으므로 그대로 내보내지 않는다.
    if (upstream.status === 403) return fail(headers, 429, "quota_exhausted");
    if (upstream.status === 400) return fail(headers, 400, "invalid_request");
    return fail(headers, 502, "upstream_error");
  }

  let body: {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        thumbnails?: Record<string, { url?: string } | undefined>;
      };
    }>;
  };
  try {
    body = await upstream.json();
  } catch {
    return fail(headers, 502, "upstream_error");
  }

  const results = (body.items ?? [])
    .map((item) => {
      const videoId = item?.id?.videoId ?? "";
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
      const snippet = item.snippet ?? {};
      const thumbnails = snippet.thumbnails ?? {};
      const thumbnail =
        thumbnails.medium?.url ?? thumbnails.default?.url ?? thumbnails.high?.url ?? "";
      return {
        videoId,
        title: String(snippet.title ?? "").slice(0, 200),
        channelTitle: String(snippet.channelTitle ?? "").slice(0, 120),
        thumbnail: /^https:\/\//.test(thumbnail) ? thumbnail : "",
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return new Response(
    JSON.stringify({ results, remaining: quota?.remaining ?? null }),
    { status: 200, headers },
  );
});
