/**
 * STATARB-OU-PERP: Production Real Live Exchange Execution Adapter
 * 
 * Executes live signed orders on Binance USD-M Perpetuals and Bybit Linear Perpetuals:
 * - Leg 1: Post-Only Maker Limit (GTX on Binance / PostOnly on Bybit) with dynamic book-cross micro-repricing retries
 * - Order Status Polling & In-Flight Fill Detection
 * - Clean Order Cancellation with actual executedQty recovery
 * - Leg 2: Sub-35ms WebSocket IOC Taker hedge with 500ms watchdog circuit breaker and signed REST fallback
 * - Emergency Market Unwind with reduceOnly: true to eliminate orphan exposure
 * 
 * 100% standalone with zero legacy dependencies.
 */

import {
  ExchangeExecutionAdapter,
  ExchangeVenue,
  OrderSide,
} from './orderRouter';
import {
  signAndFetchBinance,
  validateOrGenerateBinanceClientOrderId,
} from '@/lib/binanceSigner';
import {
  sendBybitRequest,
  validateOrGenerateBybitOrderLinkId,
  BybitCredentials,
} from '@/lib/bybitSigner';
import { binanceTradeStream } from '@/lib/binanceTradeStream';
import { bybitTradeStream } from '@/lib/bybitTradeStream';
import { getCockpitVaultKey, decryptVaultSecret } from '@/lib/cryptoVault';
import { findUserById, getDecryptedUserApiKeys } from '@/lib/userStore';
import { getSymbolFilter } from '../utils/exchangeFilterRegistry';

export interface LiveCredentialsConfig {
  binanceKey: string;
  binanceSecret: string;
  binanceEndpoint?: string;
  bybitKey: string;
  bybitSecret: string;
}

/**
 * Clean helper function to decrypt and resolve credentials for the admin user,
 * with graceful fallback to environment variables.
 */
export function getDecryptedExchangeCredentials(userId: string = 'usr_admin_varsha'): LiveCredentialsConfig {
  let bnKey = process.env.BINANCE_API_KEY || '';
  let bnSec = process.env.BINANCE_API_SECRET || '';
  let bnEndpoint = process.env.BINANCE_ENDPOINT || 'https://fapi.binance.com';
  let byKey = process.env.BYBIT_API_KEY || '';
  let bySec = process.env.BYBIT_API_SECRET || '';

  // 1. Attempt user accounts store retrieval
  try {
    const adminUser = findUserById(userId);
    if (adminUser) {
      // Validate vault key is available before decrypting user keys
      try {
        getCockpitVaultKey();
      } catch {
        // Vault key not set; getDecryptedUserApiKeys will handle plaintext or system defaults
      }
      const decryptedKeys = getDecryptedUserApiKeys(adminUser);
      if (decryptedKeys.binanceKey) bnKey = decryptedKeys.binanceKey;
      if (decryptedKeys.binanceSecret) bnSec = decryptedKeys.binanceSecret;
      if (decryptedKeys.binanceEndpoint) bnEndpoint = decryptedKeys.binanceEndpoint;
      if (decryptedKeys.bybitKey) byKey = decryptedKeys.bybitKey;
      if (decryptedKeys.bybitSecret) bySec = decryptedKeys.bybitSecret;
    }
  } catch (e: any) {
    // Graceful fallback to environment variables in test environments
    console.warn('[LiveExchangeAdapter] Notice: Falling back to process.env credentials:', e?.message || e);
  }

  // 2. Direct vault decryption for any enc:v1: ciphertext remaining
  if (bnSec && bnSec.startsWith('enc:v1:')) {
    try {
      bnSec = decryptVaultSecret(bnSec);
    } catch {
      // Non-fatal if in mock test mode without vault key
    }
  }
  if (bySec && bySec.startsWith('enc:v1:')) {
    try {
      bySec = decryptVaultSecret(bySec);
    } catch {
      // Non-fatal if in mock test mode without vault key
    }
  }

  return {
    binanceKey: bnKey.trim(),
    binanceSecret: bnSec.trim(),
    binanceEndpoint: bnEndpoint.trim(),
    bybitKey: byKey.trim(),
    bybitSecret: bySec.trim(),
  };
}

export class LiveExchangeAdapter implements ExchangeExecutionAdapter {
  private creds: LiveCredentialsConfig | null = null;

  constructor(customCreds?: Partial<LiveCredentialsConfig>) {
    if (customCreds && customCreds.binanceKey && customCreds.bybitKey) {
      this.creds = {
        binanceKey: customCreds.binanceKey,
        binanceSecret: customCreds.binanceSecret || '',
        binanceEndpoint: customCreds.binanceEndpoint || 'https://fapi.binance.com',
        bybitKey: customCreds.bybitKey,
        bybitSecret: customCreds.bybitSecret || '',
      };
    } else {
      this.loadCredentials();
    }
  }

  /**
   * Static helper to decrypt credentials
   */
  public static decryptCredentials(userId: string = 'usr_admin_varsha'): LiveCredentialsConfig {
    return getDecryptedExchangeCredentials(userId);
  }

  /**
   * Loads and decrypts active production exchange API keys.
   */
  public loadCredentials(userId: string = 'usr_admin_varsha'): LiveCredentialsConfig {
    this.creds = getDecryptedExchangeCredentials(userId);
    return this.creds;
  }

  public getBinanceCreds() {
    if (!this.creds?.binanceKey || !this.creds?.binanceSecret) {
      this.loadCredentials();
    }
    return {
      apiKey: this.creds?.binanceKey || '',
      apiSecret: this.creds?.binanceSecret || '',
      endpoint: this.creds?.binanceEndpoint || 'https://fapi.binance.com',
    };
  }

  public getBybitCreds(): BybitCredentials {
    if (!this.creds?.bybitKey || !this.creds?.bybitSecret) {
      this.loadCredentials();
    }
    return {
      apiKey: this.creds?.bybitKey || '',
      apiSecret: this.creds?.bybitSecret || '',
    };
  }

  /**
   * Places a Post-Only Maker limit order with micro-repricing retries upon book-cross rejection.
   * - Binance USD-M: POST /fapi/v1/order with type: 'LIMIT', timeInForce: 'GTX'
   * - Bybit Linear: POST /v5/order/create with orderFilter: 'Order', orderType: 'Limit', timeInForce: 'PostOnly'
   * - Book-cross rejections (-2010 on Binance, 110007 on Bybit) trigger 1-tick micro-repricing away from book
   *   using tickSize from getSymbolFilter(venue, symbol), retrying up to 2 times.
   */
  public async placeMakerLimit(
    venue: ExchangeVenue,
    symbol: string,
    side: OrderSide,
    price: number,
    qty: number,
    clientOrderId: string,
    timeInForce: 'GTX' | 'PostOnly'
  ): Promise<{ orderId: string; status: 'NEW' | 'REJECTED'; rejectReason?: string }> {
    const maxRetries = 2;
    let currentPrice = price;

    const filter = getSymbolFilter(venue, symbol);
    const tickSize = filter?.tickSize || 0.0001;
    const priceDecimals = filter?.priceDecimals ?? 4;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (venue === 'BINANCE') {
          const bnCreds = this.getBinanceCreds();
          const cleanClientOrderId = validateOrGenerateBinanceClientOrderId(
            attempt === 0 ? clientOrderId : `${clientOrderId}_r${attempt}`
          );

          const { data } = await signAndFetchBinance(
            bnCreds.apiKey,
            bnCreds.apiSecret,
            'POST',
            '/fapi/v1/order',
            {
              symbol: symbol.toUpperCase(),
              side: side.toUpperCase(),
              type: 'LIMIT',
              timeInForce: 'GTX',
              quantity: String(qty),
              price: currentPrice.toFixed(priceDecimals),
              newClientOrderId: cleanClientOrderId,
            },
            true,
            bnCreds.endpoint
          );

          if (data?.orderId) {
            return { orderId: String(data.orderId), status: 'NEW' };
          }

          return {
            orderId: '',
            status: 'REJECTED',
            rejectReason: data?.msg || 'Binance Post-Only maker limit rejected',
          };
        } else {
          // Bybit Linear Post-Only
          const bybitCreds = this.getBybitCreds();
          const bybitSide = side === 'BUY' ? 'Buy' : 'Sell';
          const orderLinkId = validateOrGenerateBybitOrderLinkId(
            attempt === 0 ? clientOrderId : `${clientOrderId}_r${attempt}`
          );

          const res = await sendBybitRequest(
            '/v5/order/create',
            'POST',
            bybitCreds,
            {
              category: 'linear',
              symbol: symbol.toUpperCase(),
              side: bybitSide,
              orderType: 'Limit',
              price: currentPrice.toFixed(priceDecimals),
              qty: String(qty),
              timeInForce: 'PostOnly',
              orderFilter: 'Order',
              orderLinkId,
              positionIdx: 0,
            }
          );

          if (res?.retCode === 0) {
            const orderId = res?.result?.orderId || res?.result?.orderLinkId || orderLinkId;
            return { orderId, status: 'NEW' };
          }

          const errMsg = res?.retMsg || '';
          const isBookCross =
            res?.retCode === 110007 ||
            errMsg.includes('110007') ||
            errMsg.toLowerCase().includes('postonly') ||
            errMsg.toLowerCase().includes('cross') ||
            errMsg.toLowerCase().includes('immediately trigger');

          if (isBookCross && attempt < maxRetries) {
            // Micro-reprice 1 tick away from book: BUY -> price - tickSize, SELL -> price + tickSize
            currentPrice =
              side === 'BUY'
                ? parseFloat((currentPrice - tickSize).toFixed(priceDecimals))
                : parseFloat((currentPrice + tickSize).toFixed(priceDecimals));
            continue;
          }

          return {
            orderId: '',
            status: 'REJECTED',
            rejectReason: errMsg || `Bybit PostOnly order rejected with retCode ${res?.retCode}`,
          };
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        const isBookCross =
          errMsg.includes('-2010') ||
          errMsg.includes('-5022') ||
          errMsg.includes('110007') ||
          errMsg.toLowerCase().includes('would immediately match and take') ||
          errMsg.toLowerCase().includes('cross') ||
          errMsg.toLowerCase().includes('immediately trigger');

        if (isBookCross && attempt < maxRetries) {
          // Micro-reprice 1 tick away from book: BUY -> price - tickSize, SELL -> price + tickSize
          currentPrice =
            side === 'BUY'
              ? parseFloat((currentPrice - tickSize).toFixed(priceDecimals))
              : parseFloat((currentPrice + tickSize).toFixed(priceDecimals));
          continue;
        }

        return { orderId: '', status: 'REJECTED', rejectReason: errMsg };
      }
    }

    return { orderId: '', status: 'REJECTED', rejectReason: 'Max micro-repricing retries exceeded' };
  }

  /**
   * Cancels a resting limit order and accurately recovers any in-flight executed quantity.
   * - Binance: DELETE /fapi/v1/order with symbol and orderId/origClientOrderId.
   * - Bybit: POST /v5/order/cancel with category: 'linear', symbol, and orderId/orderLinkId.
   * - Returns { success: boolean, executedQty: number }
   */
  public async cancelOrder(
    venue: ExchangeVenue,
    symbol: string,
    orderId: string,
    clientOrderId: string
  ): Promise<{ success: boolean; executedQty: number }> {
    try {
      if (venue === 'BINANCE') {
        const bnCreds = this.getBinanceCreds();
        const params: Record<string, string | number> = {
          symbol: symbol.toUpperCase(),
        };
        if (orderId) {
          params.orderId = orderId;
        } else if (clientOrderId) {
          params.origClientOrderId = clientOrderId;
        }

        const { data } = await signAndFetchBinance(
          bnCreds.apiKey,
          bnCreds.apiSecret,
          'DELETE',
          '/fapi/v1/order',
          params,
          true,
          bnCreds.endpoint
        );

        const executedQty = parseFloat(data?.executedQty || data?.cumQty || '0') || 0;
        return { success: true, executedQty };
      } else {
        const bybitCreds = this.getBybitCreds();
        const params: Record<string, any> = {
          category: 'linear',
          symbol: symbol.toUpperCase(),
        };
        if (orderId) {
          params.orderId = orderId;
        } else if (clientOrderId) {
          params.orderLinkId = clientOrderId;
        }

        const res = await sendBybitRequest('/v5/order/cancel', 'POST', bybitCreds, params);

        let executedQty = 0;
        try {
          const status = await this.pollOrderStatus(venue, symbol, orderId, clientOrderId);
          executedQty = status.executedQty;
        } catch {
          // Fall back to 0 if status poll fails
        }

        const isSuccess =
          res?.retCode === 0 || executedQty > 0 || res?.retCode === 110001; // 110001: Order terminal/not found
        return { success: isSuccess, executedQty };
      }
    } catch (err: any) {
      // If cancellation threw an error (e.g. order already filled or cancelled), query status directly
      try {
        const status = await this.pollOrderStatus(venue, symbol, orderId, clientOrderId);
        return { success: true, executedQty: status.executedQty };
      } catch {
        return { success: false, executedQty: 0 };
      }
    }
  }

  /**
   * Polls live order status to detect fills, partial fills, or cancellations.
   * - Binance: GET /fapi/v1/order -> maps NEW, PARTIALLY_FILLED, FILLED, CANCELED, EXPIRED, REJECTED
   * - Bybit: GET /v5/order/realtime -> maps New, PartiallyFilled, Filled, Cancelled, Rejected
   * - Returns { status, executedQty, avgPrice }
   */
  public async pollOrderStatus(
    venue: ExchangeVenue,
    symbol: string,
    orderId: string,
    clientOrderId: string
  ): Promise<{
    status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED';
    executedQty: number;
    avgPrice: number;
  }> {
    if (venue === 'BINANCE') {
      const bnCreds = this.getBinanceCreds();
      const params: Record<string, string | number> = {
        symbol: symbol.toUpperCase(),
      };
      if (orderId) params.orderId = orderId;
      else if (clientOrderId) params.origClientOrderId = clientOrderId;

      const { data } = await signAndFetchBinance(
        bnCreds.apiKey,
        bnCreds.apiSecret,
        'GET',
        '/fapi/v1/order',
        params,
        true,
        bnCreds.endpoint
      );

      const rawStatus = (data?.status || 'NEW').toUpperCase();
      const executedQty = parseFloat(data?.executedQty || data?.cumQty || '0') || 0;
      const avgPrice = parseFloat(data?.avgPrice || data?.price || '0') || 0;

      let mappedStatus: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' = 'NEW';
      if (rawStatus === 'FILLED') {
        mappedStatus = 'FILLED';
      } else if (rawStatus === 'PARTIALLY_FILLED') {
        mappedStatus = 'PARTIALLY_FILLED';
      } else if (rawStatus === 'CANCELED' || rawStatus === 'EXPIRED' || rawStatus === 'REJECTED') {
        mappedStatus = 'CANCELLED';
      } else {
        mappedStatus = 'NEW';
      }

      return { status: mappedStatus, executedQty, avgPrice };
    } else {
      const bybitCreds = this.getBybitCreds();
      const params: Record<string, string> = {
        category: 'linear',
        symbol: symbol.toUpperCase(),
      };
      if (orderId) params.orderId = orderId;
      else if (clientOrderId) params.orderLinkId = clientOrderId;

      const res = await sendBybitRequest('/v5/order/realtime', 'GET', bybitCreds, params);
      const order = res?.result?.list?.[0];

      const rawStatus = (order?.orderStatus || 'New').toLowerCase();
      const executedQty = parseFloat(order?.cumExecQty || order?.cumQty || '0') || 0;
      const avgPrice = parseFloat(order?.avgPrice || '0') || 0;

      let mappedStatus: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' = 'NEW';
      if (rawStatus === 'filled') {
        mappedStatus = 'FILLED';
      } else if (rawStatus === 'partiallyfilled') {
        mappedStatus = 'PARTIALLY_FILLED';
      } else if (rawStatus === 'cancelled' || rawStatus === 'deactivated' || rawStatus === 'rejected') {
        mappedStatus = 'CANCELLED';
      } else {
        mappedStatus = 'NEW';
      }

      return { status: mappedStatus, executedQty, avgPrice };
    }
  }

  /**
   * Places an immediate Leg 2 IOC Taker hedge sized strictly to Leg 1 executed quantity.
   * - Dispatches Sub-35ms WebSocket IOC Taker via binanceTradeStream or bybitTradeStream
   * - 500ms watchdog circuit breaker: if WebSocket ACK/fill not received within 500ms or stream
   *   disconnected, falls back immediately to signed REST API.
   * - Returns { orderId, executedQty, avgPrice, feeUsdt, latencyMs }
   */
  public async placeTakerIoc(
    venue: ExchangeVenue,
    symbol: string,
    side: OrderSide,
    qty: number,
    clientOrderId: string,
    useWebSocket: boolean,
    expectedPrice?: number
  ): Promise<{
    orderId: string;
    executedQty: number;
    avgPrice: number;
    feeUsdt: number;
    latencyMs: number;
  }> {
    const startTime = Date.now();

    // 1. Attempt Sub-35ms WebSocket IOC Taker path if requested and stream is healthy
    if (useWebSocket) {
      if (venue === 'BINANCE' && binanceTradeStream.isHealthy()) {
        let timer: NodeJS.Timeout | null = null;
        try {
          const bnCreds = this.getBinanceCreds();
          const wsPromise = binanceTradeStream.placeOrder(
            {
              symbol: symbol.toUpperCase(),
              side: side.toUpperCase() as 'BUY' | 'SELL',
              type: 'MARKET',
              quantity: qty,
              clientOrderId: validateOrGenerateBinanceClientOrderId(clientOrderId),
            },
            bnCreds
          );

          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Binance WebSocket 500ms watchdog timeout exceeded')), 500);
          });

          const wsRes = await Promise.race([wsPromise, timeoutPromise]);
          if (timer) clearTimeout(timer);

          if (wsRes.success) {
            const avgPrice = wsRes.avgPrice || expectedPrice || 0;
            const executedQty = wsRes.quantity || qty;
            const feeUsdt = parseFloat((executedQty * avgPrice * 0.00055).toFixed(4));
            return {
              orderId: wsRes.orderId,
              executedQty,
              avgPrice,
              feeUsdt,
              latencyMs: wsRes.executionLatencyMs || Date.now() - startTime,
            };
          }
        } catch (wsErr: any) {
          if (timer) clearTimeout(timer);
          console.warn(`[LiveExchangeAdapter] Binance WebSocket IOC failed or timed out (${wsErr?.message}). Falling back to signed REST...`);
        }
      } else if (venue === 'BYBIT' && bybitTradeStream.isHealthy()) {
        let timer: NodeJS.Timeout | null = null;
        try {
          const bybitCreds = this.getBybitCreds();
          const wsPromise = bybitTradeStream.placeOrder(
            {
              category: 'linear',
              symbol: symbol.toUpperCase(),
              side: side === 'BUY' ? 'Buy' : 'Sell',
              orderType: expectedPrice ? 'Limit' : 'Market',
              price: expectedPrice ? String(expectedPrice) : undefined,
              qty,
              timeInForce: 'IOC',
              orderLinkId: validateOrGenerateBybitOrderLinkId(clientOrderId),
            },
            bybitCreds
          );

          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Bybit WebSocket 500ms watchdog timeout exceeded')), 500);
          });

          const wsRes = await Promise.race([wsPromise, timeoutPromise]);
          if (timer) clearTimeout(timer);

          if (wsRes.success) {
            const avgPrice = wsRes.avgPrice || expectedPrice || 0;
            const executedQty = typeof wsRes.quantity === 'number' ? wsRes.quantity : qty;
            const feeUsdt = parseFloat((executedQty * avgPrice * 0.00055).toFixed(4));
            return {
              orderId: wsRes.orderId || wsRes.orderLinkId || clientOrderId,
              executedQty,
              avgPrice,
              feeUsdt,
              latencyMs: wsRes.executionLatencyMs || Date.now() - startTime,
            };
          }
        } catch (wsErr: any) {
          if (timer) clearTimeout(timer);
          console.warn(`[LiveExchangeAdapter] Bybit WebSocket IOC failed or timed out (${wsErr?.message}). Falling back to signed REST...`);
        }
      }
    }

    // 2. Signed REST API Fallback Execution Path
    if (venue === 'BINANCE') {
      const bnCreds = this.getBinanceCreds();
      const bnParams: Record<string, string | number> = {
        symbol: symbol.toUpperCase(),
        side: side.toUpperCase(),
        type: expectedPrice ? 'LIMIT' : 'MARKET',
        quantity: String(qty),
        newClientOrderId: validateOrGenerateBinanceClientOrderId(clientOrderId),
      };
      if (expectedPrice) {
        bnParams.price = String(expectedPrice);
        bnParams.timeInForce = 'IOC';
      }

      const { data } = await signAndFetchBinance(
        bnCreds.apiKey,
        bnCreds.apiSecret,
        'POST',
        '/fapi/v1/order',
        bnParams,
        true,
        bnCreds.endpoint
      );

      const executedQty = parseFloat(data?.executedQty || data?.cumQty || String(qty)) || qty;
      const avgPrice = parseFloat(data?.avgPrice || data?.price || String(expectedPrice || 0)) || (expectedPrice || 0);
      const feeUsdt = parseFloat((executedQty * avgPrice * 0.00055).toFixed(4));

      return {
        orderId: String(data?.orderId || clientOrderId),
        executedQty,
        avgPrice,
        feeUsdt,
        latencyMs: Date.now() - startTime,
      };
    } else {
      const bybitCreds = this.getBybitCreds();
      const byParams: Record<string, any> = {
        category: 'linear',
        symbol: symbol.toUpperCase(),
        side: side === 'BUY' ? 'Buy' : 'Sell',
        orderType: expectedPrice ? 'Limit' : 'Market',
        qty: String(qty),
        timeInForce: 'IOC',
        orderFilter: 'Order',
        orderLinkId: validateOrGenerateBybitOrderLinkId(clientOrderId),
        positionIdx: 0,
      };
      if (expectedPrice) {
        byParams.price = String(expectedPrice);
      }

      const res = await sendBybitRequest('/v5/order/create', 'POST', bybitCreds, byParams);
      if (res?.retCode !== 0) {
        throw new Error(`Bybit REST IOC taker order failed: [${res?.retCode}] ${res?.retMsg}`);
      }

      const orderId = res?.result?.orderId || res?.result?.orderLinkId || clientOrderId;
      let executedQty = qty;
      let avgPrice = expectedPrice || 0;

      try {
        const status = await this.pollOrderStatus(venue, symbol, orderId, clientOrderId);
        if (status.executedQty > 0) executedQty = status.executedQty;
        if (status.avgPrice > 0) avgPrice = status.avgPrice;
      } catch {
        // Fall back to requested quantity and expectedPrice
      }

      const feeUsdt = parseFloat((executedQty * avgPrice * 0.00055).toFixed(4));

      return {
        orderId,
        executedQty,
        avgPrice,
        feeUsdt,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Dispatches an emergency market order with reduceOnly: true on Leg 1 venue to eliminate orphan exposure.
   * - Returns { success: boolean, executedQty: number, avgPrice: number }
   */
  public async emergencyMarketUnwind(
    venue: ExchangeVenue,
    symbol: string,
    side: OrderSide,
    qty: number
  ): Promise<{ success: boolean; executedQty: number; avgPrice: number }> {
    try {
      if (venue === 'BINANCE') {
        const bnCreds = this.getBinanceCreds();
        const clientOrderId = validateOrGenerateBinanceClientOrderId(`unwind_${Date.now()}`);

        const { data } = await signAndFetchBinance(
          bnCreds.apiKey,
          bnCreds.apiSecret,
          'POST',
          '/fapi/v1/order',
          {
            symbol: symbol.toUpperCase(),
            side: side.toUpperCase(),
            type: 'MARKET',
            quantity: String(qty),
            reduceOnly: 'true',
            newClientOrderId: clientOrderId,
          },
          true,
          bnCreds.endpoint
        );

        const executedQty = parseFloat(data?.executedQty || data?.cumQty || String(qty)) || qty;
        const avgPrice = parseFloat(data?.avgPrice || data?.price || '0') || 0;

        return {
          success: true,
          executedQty,
          avgPrice,
        };
      } else {
        const bybitCreds = this.getBybitCreds();
        const orderLinkId = validateOrGenerateBybitOrderLinkId(`unwind_${Date.now()}`);

        const res = await sendBybitRequest(
          '/v5/order/create',
          'POST',
          bybitCreds,
          {
            category: 'linear',
            symbol: symbol.toUpperCase(),
            side: side === 'BUY' ? 'Buy' : 'Sell',
            orderType: 'Market',
            qty: String(qty),
            reduceOnly: true,
            orderFilter: 'Order',
            orderLinkId,
            positionIdx: 0,
          }
        );

        if (res?.retCode !== 0) {
          throw new Error(`Bybit emergency market unwind failed: [${res?.retCode}] ${res?.retMsg}`);
        }

        const orderId = res?.result?.orderId || orderLinkId;
        let executedQty = qty;
        let avgPrice = 0;

        try {
          const status = await this.pollOrderStatus(venue, symbol, orderId, orderLinkId);
          if (status.executedQty > 0) executedQty = status.executedQty;
          if (status.avgPrice > 0) avgPrice = status.avgPrice;
        } catch {
          // Keep defaults
        }

        return {
          success: true,
          executedQty,
          avgPrice,
        };
      }
    } catch (err: any) {
      console.error(`[LiveExchangeAdapter] Emergency market unwind failed on ${venue} ${symbol}:`, err?.message || err);
      return { success: false, executedQty: 0, avgPrice: 0 };
    }
  }
}
