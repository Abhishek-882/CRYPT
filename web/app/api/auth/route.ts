import { NextRequest, NextResponse } from "next/server";
import {
  authenticateUser,
  registerUser,
  findUserByEmail,
  findUserById,
  updateUserApiKeys,
  createSessionToken,
  verifySessionToken,
  ADMIN_EMAIL_PRIMARY,
  ADMIN_EMAIL_ALIAS,
  ADMIN_DEFAULT_PASSWORD,
  SYSTEM_DEFAULT_BINANCE_KEY,
  SYSTEM_DEFAULT_BINANCE_SECRET,
  SYSTEM_DEFAULT_BITGET_KEY,
  SYSTEM_DEFAULT_BITGET_SECRET,
  SYSTEM_DEFAULT_BITGET_PASSPHRASE,
  SYSTEM_DEFAULT_COINDCX_KEY,
  SYSTEM_DEFAULT_COINDCX_SECRET,
  SYSTEM_DEFAULT_BYBIT_KEY,
  SYSTEM_DEFAULT_BYBIT_SECRET,
} from "@/lib/userStore";
import { recordBatchConsents, ConsentPurpose } from "@/lib/complianceStore";
import { checkRateLimit } from "@/lib/rateLimiter";

export const dynamic = "force-dynamic";

/**
 * Cloudflare Turnstile CAPTCHA Token Verification under Section 8(5) DPDP Act 2023
 * (Reasonable security safeguards against automated credential stuffing and bot attacks)
 */
async function verifyCaptchaToken(token?: string, clientIp?: string): Promise<{ valid: boolean; error?: string }> {
  const secretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  // If no Turnstile secret key configured in environment, permit in test/development mode
  if (!secretKey) {
    return { valid: true };
  }

  // Mandatory token when Turnstile secret key is configured
  if (!token) {
    return { valid: false, error: "Security CAPTCHA verification required" };
  }

  // Deterministic testing bypass token strictly in test environment (FINDING-A3-07)
  if (process.env.NODE_ENV === "test" && (token === "TEST_CAPTCHA_PASS_TOKEN" || token.startsWith("XXXX.DUMMY."))) {
    return { valid: true };
  }

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (clientIp) formData.append("remoteip", clientIp);

    const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const verifyData = await verifyRes.json();
    if (!verifyData.success) {
      return { valid: false, error: "CAPTCHA challenge verification failed. Please try again." };
    }
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: `CAPTCHA verification network error: ${err.message}` };
  }
}

function sanitizeUserApiKeys(user: any) {
  const keys = user?.apiKeys || {};
  const isAdmin = user?.role === "admin";

  const binanceKey = keys.binanceKey || (isAdmin ? SYSTEM_DEFAULT_BINANCE_KEY : "");
  const hasBinanceSecret = Boolean(keys.binanceSecret || (isAdmin && SYSTEM_DEFAULT_BINANCE_SECRET));

  const bitgetKey = keys.bitgetKey || (isAdmin ? SYSTEM_DEFAULT_BITGET_KEY : "");
  const hasBitgetSecret = Boolean(keys.bitgetSecret || (isAdmin && SYSTEM_DEFAULT_BITGET_SECRET));
  const bitgetPassphrase = keys.bitgetPassphrase || (isAdmin ? SYSTEM_DEFAULT_BITGET_PASSPHRASE : "");
  const hasBitgetPassphrase = Boolean(keys.bitgetPassphrase || (isAdmin && SYSTEM_DEFAULT_BITGET_PASSPHRASE));

  const coindcxKey = keys.coindcxKey || (isAdmin ? SYSTEM_DEFAULT_COINDCX_KEY : "");
  const hasCoinDcxSecret = Boolean(keys.coindcxSecret || (isAdmin && SYSTEM_DEFAULT_COINDCX_SECRET));

  const bybitKey = keys.bybitKey || (isAdmin ? SYSTEM_DEFAULT_BYBIT_KEY : "");
  const hasBybitSecret = Boolean(keys.bybitSecret || (isAdmin && SYSTEM_DEFAULT_BYBIT_SECRET));

  return {
    binanceKey,
    binanceSecret: hasBinanceSecret ? "••••••••••••" : "",
    hasBinanceSecret,
    binanceEndpoint: keys.binanceEndpoint || (isAdmin ? (process.env.BINANCE_ENDPOINT || "https://fapi.binance.com") : "https://testnet.binancefuture.com"),
    bitgetKey,
    bitgetSecret: hasBitgetSecret ? "••••••••••••" : "",
    hasBitgetSecret,
    bitgetPassphrase: hasBitgetPassphrase ? "••••••••••••" : "",
    hasBitgetPassphrase,
    bitgetEnv: keys.bitgetEnv || "demo",
    coindcxKey,
    coindcxSecret: hasCoinDcxSecret ? "••••••••••••" : "",
    hasCoinDcxSecret,
    bybitKey,
    bybitSecret: hasBybitSecret ? "••••••••••••" : "",
    hasBybitSecret,
    bybitProxy: keys.bybitProxy || "",
    bybitBaseUrl: keys.bybitBaseUrl || "",
    bybitBackupProxy: keys.bybitBackupProxy || "",
    bybitBackupBaseUrl: keys.bybitBackupBaseUrl || "",
  };
}

export async function GET(req: NextRequest) {
  const cookieHeader = req.headers.get("cookie") || "";
  const authCookie = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("auth_session="));

  let user = null;

  if (authCookie) {
    const rawVal = decodeURIComponent(authCookie.replace("auth_session=", "").trim());
    if (rawVal) {
      const verifiedUserId = verifySessionToken(rawVal);
      if (verifiedUserId) {
        user = findUserById(verifiedUserId);
      }
    }
  }

  if (!user) {
    return NextResponse.json({
      success: true,
      isLoggedIn: false,
      user: null,
    });
  }

  // Sanitize user object for client
  const safeUser = {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
    apiKeys: sanitizeUserApiKeys(user),
  };

  return NextResponse.json({
    success: true,
    isLoggedIn: true,
    user: safeUser,
  });
}

export async function POST(req: NextRequest) {
  try {
    const forwarded = req.headers.get("x-forwarded-for");
    const clientIp = forwarded ? forwarded.split(",")[0].trim() : (req.headers.get("x-real-ip") || "127.0.0.1");
    const isHttps = req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:";

    // Rate Limiting Protection (Mitigate Brute Force & Credential Stuffing)
    const rateLimit = checkRateLimit(`auth:${clientIp}`, { windowMs: 60000, maxRequests: 25 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many authentication attempts. Please try again in 60 seconds." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));

    // Anti-Spam / Anti-Bot Honeypot Defense
    if (body.hp_token || body.hp_security_check) {
      return NextResponse.json({ success: false, error: "Automated submission rejected." }, { status: 400 });
    }

    const action = body.action || "login";

    if (action === "logout") {
      const res = NextResponse.json({
        success: true,
        action: "logout",
        message: "Successfully signed out. Autonomous bot runs on server 24/7 if configured.",
      });
      res.cookies.set("auth_session", "", { path: "/", maxAge: 0, secure: isHttps, sameSite: "lax" });
      res.cookies.set("auth_role", "", { path: "/", maxAge: 0, secure: isHttps, sameSite: "lax" });
      res.cookies.set("auth_email", "", { path: "/", maxAge: 0, secure: isHttps, sameSite: "lax" });
      return res;
    }

    if (action === "signup") {
      const captchaToken = body.captchaToken || req.headers.get("x-captcha-token") || undefined;
      const captchaCheck = await verifyCaptchaToken(captchaToken, clientIp);
      if (!captchaCheck.valid) {
        return NextResponse.json({ success: false, error: captchaCheck.error }, { status: 400 });
      }

      const { email, password, username, consentAuthAndExecution, consentExchangeDispatch, consentTelemetry } = body;
      if (!email || !password) {
        return NextResponse.json(
          { success: false, error: "Email and password are required" },
          { status: 400 }
        );
      }

      // DPDP Act 2023 Section 6 Verification: Specific, informed affirmative opt-in consent
      if (!consentAuthAndExecution || !consentExchangeDispatch) {
        return NextResponse.json(
          {
            success: false,
            error: "Consent required: Under the DPDP Act 2023, you must accept personal data processing and exchange dispatch to create an account.",
          },
          { status: 400 }
        );
      }

      const result = registerUser(email, password, username);
      if (!result.success || !result.user) {
        return NextResponse.json(
          { success: false, error: result.error || "Failed to register" },
          { status: 400 }
        );
      }

      const user = result.user;

      // Store verifiable consent audit log in compliance store
      recordBatchConsents(
        user.email,
        [
          { purpose: "PURPOSE_AUTH_AND_EXECUTION", status: "GRANTED" },
          { purpose: "PURPOSE_EXCHANGE_DISPATCH", status: "GRANTED" },
          { purpose: "PURPOSE_DIAGNOSTICS_TELEMETRY", status: consentTelemetry ? "GRANTED" : "WITHDRAWN" },
        ],
        {
          userId: user.id,
          ipAddress: clientIp,
          userAgent: req.headers.get("user-agent") || "",
        }
      );

      const safeUser = {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        apiKeys: user.apiKeys,
      };

      const res = NextResponse.json({
        success: true,
        action: "signup",
        user: safeUser,
      });

      const sessionToken = createSessionToken(user.id);
      res.cookies.set("auth_session", sessionToken, {
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
        httpOnly: true,
        sameSite: "lax",
        secure: isHttps,
      });
      res.cookies.set("auth_role", user.role, { path: "/", maxAge: 60 * 60 * 24 * 7, secure: isHttps, sameSite: "lax" });
      res.cookies.set("auth_email", user.email, { path: "/", maxAge: 60 * 60 * 24 * 7, secure: isHttps, sameSite: "lax" });

      return res;
    }

    if (action === "update_keys") {
      const cookieHeader = req.headers.get("cookie") || "";
      const authCookie = cookieHeader
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith("auth_session="));
      const rawSession = authCookie ? decodeURIComponent(authCookie.replace("auth_session=", "").trim()) : "";
      const verifiedUserId = verifySessionToken(rawSession);

      if (!verifiedUserId) {
        return NextResponse.json({ success: false, error: "Unauthorized session" }, { status: 401 });
      }

      const result = updateUserApiKeys(verifiedUserId, body.apiKeys || {});
      if (!result.success || !result.user) {
        return NextResponse.json({ success: false, error: result.error || "Failed to update keys" }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        user: {
          id: result.user.id,
          email: result.user.email,
          role: result.user.role,
          apiKeys: sanitizeUserApiKeys(result.user),
        },
      });
    }

    // Default: Login
    const captchaToken = body.captchaToken || req.headers.get("x-captcha-token") || undefined;
    const captchaCheck = await verifyCaptchaToken(captchaToken, clientIp);
    if (!captchaCheck.valid) {
      return NextResponse.json({ success: false, error: captchaCheck.error }, { status: 400 });
    }

    const { email, password } = body;
    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and security password required" },
        { status: 400 }
      );
    }

    const authResult = authenticateUser(email, password);
    if (!authResult.success || !authResult.user) {
      return NextResponse.json(
        { success: false, error: authResult.error || "Authentication failed" },
        { status: 401 }
      );
    }

    const user = authResult.user;
    const safeUser = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      apiKeys: sanitizeUserApiKeys(user),
    };

    const res = NextResponse.json({
      success: true,
      action: "login",
      user: safeUser,
    });

    const loginSessionToken = createSessionToken(user.id);
    res.cookies.set("auth_session", loginSessionToken, {
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
    });
    res.cookies.set("auth_role", user.role, { path: "/", maxAge: 60 * 60 * 24 * 7, secure: isHttps, sameSite: "lax" });
    res.cookies.set("auth_email", user.email, { path: "/", maxAge: 60 * 60 * 24 * 7, secure: isHttps, sameSite: "lax" });

    return res;
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
