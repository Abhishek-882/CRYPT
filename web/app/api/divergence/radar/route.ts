/**
 * Divergence Bot: Real-Time Dispersion Radar API Route
 * Location: web/app/api/divergence/radar/route.ts
 * 
 * Strict Invariants Enforced:
 * 1. ZERO BPS NOTATION: All spreads, basis, hurdles, fees, and returns formatted strictly in % notation.
 * 2. STRICT BAN ON LEGACY REFERENCES: Zero mentions of legacy bots or deprecated venues.
 * 3. Next.js App Router TS2344 Compliance: Only exports dynamic configuration and GET HTTP handler.
 *    All domain types, calculations, and in-memory singletons reside in web/lib/divergence/scanner.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDivergenceRadarFeed } from '@/lib/divergence/scanner';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const forceFresh = url.searchParams.get('fresh') === 'true';

    // Retrieve cached (2,500ms SWR) or fresh radar feed
    const response = await getDivergenceRadarFeed(undefined, forceFresh);

    const httpStatus = response.success ? 200 : 503;

    return NextResponse.json(response, {
      status: httpStatus,
      headers: {
        'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=60',
        'X-Degraded-Feed': response.degraded ? 'true' : 'false',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error in Divergence Radar';
    return NextResponse.json(
      {
        success: false,
        timestamp: Date.now(),
        cached: false,
        candidatesCount: 0,
        candidates: [],
        summary: {
          totalScanned: 0,
          qualifyingCount: 0,
          primeZoneCount: 0,
          totalPairsScanned: 0,
          dispersionPassingCount: 0,
          compressionPassingCount: 0,
        },
        error: message,
      },
      { status: 500 }
    );
  }
}
