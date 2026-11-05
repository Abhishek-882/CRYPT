"use client";

import { useState, useEffect } from "react";

export interface DualExchangeWsData {
  symbol: string;
  binancePrice: number;
  bitgetPrice: number;
  spreadBps: number;
  binanceFundingRate: number;
  bitgetFundingRate: number;
  nextFundingTime: number | null;
  fundingIntervalHours: number;
  binanceWsConnected: boolean;
  bitgetWsConnected: boolean;
}

export function useDualExchangeWebSockets(
  symbol: string,
  seedData?: any
): DualExchangeWsData {
  const [data, setData] = useState<DualExchangeWsData>({
    symbol,
    binancePrice: seedData?.binancePrice || seedData?.price || 0,
    bitgetPrice: seedData?.bitgetPrice || seedData?.price || 0,
    spreadBps: seedData?.spreadBps || 0,
    binanceFundingRate: seedData?.binanceFundingRate || 0,
    bitgetFundingRate: seedData?.bitgetFundingRate || 0,
    nextFundingTime: seedData?.nextFundingTime || null,
    fundingIntervalHours: seedData?.fundingIntervalHours || 8,
    binanceWsConnected: false,
    bitgetWsConnected: false,
  });

  useEffect(() => {
    setData((prev) => ({
      ...prev,
      symbol,
      binancePrice: seedData?.binancePrice || seedData?.price || prev.binancePrice,
      bitgetPrice: seedData?.bitgetPrice || seedData?.price || prev.bitgetPrice,
      spreadBps: seedData?.spreadBps || prev.spreadBps,
      binanceFundingRate: seedData?.binanceFundingRate || prev.binanceFundingRate,
      bitgetFundingRate: seedData?.bitgetFundingRate || prev.bitgetFundingRate,
      nextFundingTime: seedData?.nextFundingTime || prev.nextFundingTime,
      fundingIntervalHours: seedData?.fundingIntervalHours || prev.fundingIntervalHours,
    }));
  }, [symbol, seedData]);

  return data;
}
