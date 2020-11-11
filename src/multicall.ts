import { Interface } from '@ethersproject/abi';
import { InitializedPoolUpdate, PoolTokenUpdate } from './types';
import { CallInput, MultiCall } from '@indexed-finance/multicall';
import * as bmath from './bmath';
import { AddressLike, toAddress } from './utils/address';
import { BigNumber } from './utils/bignumber';
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