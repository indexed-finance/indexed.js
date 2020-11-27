import { BigNumber } from './utils/bignumber';

export interface SwapAmount {
  pool: string;
  amount: BigNumber;
}

export interface EffectivePrice {
  price?: BigNumber;
  id?: string;
  maxAmount?: string;
  swap?: string[];
  amounts?: BigNumber[];
  bestPools?: string[];
}

export type Swap = {
  pool: string;
  tokenInParam: string;
  tokenOutParam: string;
  maxPrice: string;
};

/* ===== Base Types ===== */
type BasePool = {
  category: number;
  address: string;
  name: string;
  symbol: string;
  size: number;
  isPublic: boolean;
  totalWeight: BigNumber;
  totalSupply: BigNumber;
  maxTotalSupply: BigNumber;
  swapFee: BigNumber;
};

export type Token = {
  address: string;
  decimals: number;
  name: string;
  symbol: string;
  balance: BigNumber;
  // price USD from the last day the token was updated
  priceUSD: number;
};

export type InitializedPoolUpdate = {
  totalWeight: BigNumber;
  totalSupply: BigNumber;
  maxTotalSupply: BigNumber;
  swapFee: BigNumber;
  tokens: PoolTokenUpdate[];
  userBalance?: BigNumber;
}

/* ===== Pool Types ===== */
export type InitializedPool = BasePool & {
  isPublic: true;
  tokens: PoolToken[];
  feesTotalUSD: string;
  totalValueLockedUSD: string;
  totalSwapVolumeUSD: string;
  initializer: string;
};

export type UninitializedPool = BasePool & {
  isPublic: false;
  initializer: PoolInitializer;
};

export type PoolInitializer = {
  address: string;
  pool: string;
  tokens: InitializerToken[];
  totalCreditedWETH: BigNumber;
};

export type Pool = InitializedPool | UninitializedPool;

/* ===== Token Types ===== */
export type PoolToken = Token & {
  // pool is initialized
  ready: boolean;
  // actual balance
  balance: BigNumber;
  // minimum balance, if any
  minimumBalance?: BigNumber;
  // balance if ready, minimumBalance if not
  usedBalance: BigNumber;
  // normalized weight
  usedWeight: BigNumber;
  // real denorm if ready, minimum denorm if not
  usedDenorm: BigNumber;
  // normalized weight
  weight: BigNumber;
  // denormalized weight
  denorm: BigNumber;
  // normalized target weight
  desiredWeight: BigNumber;
  // denormalized target weight
  desiredDenorm: BigNumber;
};

export type InitializerToken = Token & {
  targetBalance: BigNumber;
  amountRemaining: BigNumber;
};

export type PoolTokenUpdate = {
  // token address
  address: string;
  // actual balance
  balance: BigNumber;
  // balance if ready, minimumBalance if not
  usedBalance: BigNumber;
  // normalized weight
  usedWeight: BigNumber;
  // denormalized weight if ready, minimum denorm if not
  usedDenorm: BigNumber;
}

export type InitializerTokenUpdate = {
  amountRemaining: BigNumber;
}

/* ===== Snapshot Types ===== */

export type PoolDailySnapshot = {
  date: number;
  value: number;
  totalSupply: number;
  dailyFeesUSD: number;
  dailySwapVolumeUSD: number;
  totalValueLockedUSD: number;
  totalVolumeUSD: number;
}

/* ===== Uniswap Types ===== */
export type UniswapPairData = {
  tokenA: string;
  tokenB: string;
  pairAddress: string;
  reservesA: BigNumber;
  reservesB: BigNumber;
  allowanceA?: BigNumber;
  allowanceB?: BigNumber;
  balanceB?: BigNumber;
}
