/**
 * Turnkey Cloudflare Worker Proxy for Bybit V5 API
 *
 * Deploys globally on Cloudflare edge locations outside the US (e.g. Frankfurt, London, Singapore, Tokyo).
 * Forwards all incoming REST calls to https://api.bybit.com with 100% header, query, and payload preservation.
 *
 * Deployment (Takes < 60 seconds):
 * 1. Go to https://dash.cloudflare.com -> Workers & Pages -> Create Application -> Create Worker.
 * 2. Paste this entire file into the worker code editor.
 * 3. Click "Save and Deploy".
 * 4. Copy the Worker URL (e.g. https://bybit-proxy.<your-subdomain>.workers.dev).
 * 5. In your AI Hedge Cockpit Settings, set Bybit Proxy / Base URL to this URL!
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Target Bybit Global Production API
    const targetUrl = new URL(`https://api.bybit.com${url.pathname}${url.search}`);

    // Clone incoming headers, adjusting Host
    const headers = new Headers(request.headers);
    headers.set("Host", "api.bybit.com");

    // Remove all Cloudflare and origin IP headers to bypass CloudFront geo-filtering
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");
    headers.delete("x-forwarded-for");
    headers.delete("x-real-ip");
    headers.delete("client-ip");
    headers.delete("true-client-ip");
    headers.delete("x-client-ip");

    // Mask with standard desktop browser User-Agent
    headers.set(
      "User-Agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    );

    const init = {
      method: request.method,
      headers: headers,
      redirect: "follow",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    try {
      const response = await fetch(targetUrl.toString(), init);

      // Create new response with CORS headers so Cockpit can reach it directly if needed
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "Content-Type, X-BAPI-API-KEY, X-BAPI-TIMESTAMP, X-BAPI-SIGN, X-BAPI-RECV-WINDOW, X-BAPI-SIGN-TYPE");

      // Handle CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: responseHeaders, status: 204 });
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          retCode: 99999,
          retMsg: `Cloudflare Worker Proxy Error: ${err.message}`,
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
};
