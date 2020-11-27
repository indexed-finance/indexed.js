import { Interface } from '@ethersproject/abi';
import { CallInput, MultiCall } from '@indexed-finance/multicall';
import { UNISWAP_ROUTER } from './constants';
import * as bmath from './bmath';
import { InitializedPoolUpdate, PoolTokenUpdate, UniswapPairData } from './types';
import { AddressLike, computeUniswapPairAddress, sortTokens, toAddress } from './utils/address';
import { BigNumber, toBN } from './utils/bignumber';
import { toProvider } from './utils/provider';

export async function getCurrentPoolData(
  provider_: any,
  pool: AddressLike,
  tokens: AddressLike[],
  userAddress?: string
): Promise<InitializedPoolUpdate> {
  const provider = toProvider(provider_);

  const poolAddress: string = toAddress(pool);
  const tokenAddresses: string[] = [];
  tokens.forEach((t) => {
    tokenAddresses.push(toAddress(t));
  });

  const ipoolAbi = require('./abi/IPool.json');
  const iface = new Interface(ipoolAbi);
  const multi = new MultiCall(provider);

  const calls: CallInput[] = [];
  calls.push({ target: poolAddress, function: 'getTotalDenormalizedWeight' });
  calls.push({ target: poolAddress, function: 'totalSupply' });
  calls.push({ target: poolAddress, function: 'getMaxPoolTokens' });
  calls.push({ target: poolAddress, function: 'getSwapFee' });
  if (userAddress) {
    calls.push({ target: poolAddress, function: 'balanceOf', args: [userAddress] });
  }

  for (let token of tokenAddresses) {
    calls.push({ target: poolAddress, function: 'getBalance', args: [token] });
    calls.push({ target: poolAddress, function: 'getUsedBalance', args: [token] });
    calls.push({ target: poolAddress, function: 'getDenormalizedWeight', args: [token] });
  }
  const response = await multi.multiCall(iface, calls);
  const totalDenorm = bmath.bnum(response[0]);
  const totalSupply = bmath.bnum(response[1]);
  const maxTotalSupply = bmath.bnum(response[2]);
  const swapFee = bmath.bnum(response[3]);
  let userBalance: BigNumber | undefined;
  let i = 4;
  if (userAddress) {
    userBalance = bmath.bnum(response[4]);
    i += 1;
  }
  let chunkResponse = [];
  for (; i < response.length; i += 3) {
    let chunk = response.slice(i, i + 3);
    chunkResponse.push(chunk);
  }
  const tokenInfos: PoolTokenUpdate[] = [];
  chunkResponse.forEach((r, j) => {
    let address = tokenAddresses[j];
    let balance = bmath.bnum(r[0]);
    let usedBalance = bmath.bnum(r[1]);
    let usedDenorm = bmath.bnum(r[2]);
    if (usedDenorm.eq(0)) {
      usedDenorm = bmath.MIN_WEIGHT;
    }
    tokenInfos.push({
      address,
      balance,
      usedBalance,
      usedWeight: bmath.bdiv(usedDenorm, totalDenorm),
      usedDenorm: usedDenorm
    });
  });
  return {
    userBalance,
    totalWeight: totalDenorm,
    totalSupply,
    maxTotalSupply,
    swapFee,
    tokens: tokenInfos
  }
}

export type TokenUserData = {
  allowance: BigNumber;
  balance: BigNumber;
}

export async function getTokenUserData(
  provider_: any,
  src: string,
  dst_: AddressLike,
  tokens: AddressLike[]
): Promise<TokenUserData[]> {
  const provider = toProvider(provider_);
  const ierc20Abi = require('./abi/IERC20.json');
  const iface = new Interface(ierc20Abi);
  const multi = new MultiCall(provider);
  const calls: CallInput[] = [];
  const tokenAddresses: string[] = [];
  tokens.forEach((t) => {
    tokenAddresses.push(toAddress(t));
  });
  const dst = toAddress(dst_);
  for (let token of tokenAddresses) {
    calls.push({ target: token, function: 'allowance', args: [src, dst] });
    calls.push({ target: token, function: 'balanceOf', args: [src] });
  }
  const response = await multi.multiCall(iface, calls);
  const ret: TokenUserData[] = [];
  for (let i = 0; i < response.length; i+=2) {
    let chunk = response.slice(i, i + 2);
    ret.push({ allowance: bmath.bnum(chunk[0]), balance: bmath.bnum(chunk[1]) });
  }

  return ret;
}

type UniswapMultiCallReturn = {
  tokenABalance?: BigNumber;
  ethBalance?: BigNumber;
  pairs: UniswapPairData[];
}

export async function getUniswapData(
  provider_: any,
  tokenA_: AddressLike,
  tokens: AddressLike[],
  userAddress?: string
): Promise<UniswapMultiCallReturn> {
  const provider = toProvider(provider_);
  const ierc20Abi = require('./abi/IERC20.json');
  const pairAbi = require('./abi/Pair.json');
  const multi = new MultiCall(provider);
  const calls: CallInput[] = [];
  const tokenA = toAddress(tokenA_);
  const tokenAddresses: string[] = [];
  const pairAddresses: string[] = [];
  if (userAddress) {
    calls.push({ target: tokenA, interface: ierc20Abi, function: 'balanceOf', args: [userAddress] });
  }
  tokens.forEach((t) => {
    const tokenB = toAddress(t)
    tokenAddresses.push(tokenB);
    const pairAddress = computeUniswapPairAddress(tokenA, tokenB);
    pairAddresses.push(pairAddress);
    if (userAddress) {
      calls.push({ target: tokenB, interface: ierc20Abi, function: 'balanceOf', args: [userAddress] });
      calls.push({ target: tokenA, interface: ierc20Abi, function: 'allowance', args: [userAddress, UNISWAP_ROUTER] });
      calls.push({ target: tokenB, interface: ierc20Abi, function: 'allowance', args: [userAddress, UNISWAP_ROUTER] });
    }
    calls.push({ target: pairAddress, interface: pairAbi, function: 'getReserves' });
  });
  const response = await multi.multiCall(calls);
  let ethBalance: BigNumber | undefined;
  let tokenABalance: BigNumber | undefined;
  let i = 0;
  if (userAddress) {
    let balance = await provider.getBalance(userAddress);

    tokenABalance = bmath.bnum(response[i++]);
    ethBalance = toBN(balance);
  }
  let chunks = [];
  let incr = userAddress ? 4 : 1;
  for (; i < response.length - 1; i += incr) {
    chunks.push(response.slice(i, i + incr));
  }
  const pairs: UniswapPairData[] = [];
  for (let j = 0; j < chunks.length; j++) {
    const chunk = chunks[j];
    const tokenB = tokenAddresses[j];
    const pairAddress = pairAddresses[j];
    const [token0,] = sortTokens(tokenA, tokenB);
    let balanceB: BigNumber | undefined;
    let allowanceA: BigNumber | undefined;
    let allowanceB: BigNumber | undefined;
    let reservesA: BigNumber;
    let reservesB: BigNumber;
    let rI = userAddress ? 3 : 1;
    if (userAddress) {
      balanceB = bmath.bnum(chunk[0]);
      allowanceA = bmath.bnum(chunk[1]);
      allowanceB = bmath.bnum(chunk[2]);
    }
    const [reserves0, reserves1] = chunk[rI];
    if (token0 == tokenA) {
      reservesA = bmath.bnum(reserves0);
      reservesB = bmath.bnum(reserves1);
    } else {
      reservesA = bmath.bnum(reserves1);
      reservesB = bmath.bnum(reserves0);
    }
    pairs.push({
      tokenA,
      tokenB,
      pairAddress,
      balanceB,
      allowanceA,
      allowanceB,
      reservesA,
      reservesB
    });
  }
  return {
    tokenABalance,
    ethBalance,
    pairs
  };
}
