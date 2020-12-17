import { getPools, INDEXED_RINKEBY_SUBGRAPH_URL, INDEXED_SUBGRAPH_URL, parsePoolData } from './subgraph';
export * from './multicall';
import * as bmath from './bmath';
import { UninitializedPool } from './types';
import { PoolHelper } from './pool-helper';
import { InitializerHelper } from './initializer-helper';
import { toProvider } from './utils/provider';
export * from './utils/bignumber';
export { bmath, getPools, PoolHelper };
export { UniswapHelper } from './uniswap-helper';

export async function getAllHelpers(provider_: any, userAddress?: string): Promise<{
  initialized: PoolHelper[],
  uninitialized: InitializerHelper[],
}> {
  const provider = toProvider(provider_);
  const chainID = (await provider.getNetwork()).chainId;
  let url = (chainID == 1) ? INDEXED_SUBGRAPH_URL : INDEXED_RINKEBY_SUBGRAPH_URL;
  const poolDatas = await getPools(url);
  const initialized: PoolHelper[] = [];
  const uninitialized: InitializerHelper[] = [];
  for (let poolData of poolDatas) {
    if (poolData.isPublic) {
      initialized.push(new PoolHelper(provider, chainID, poolData, userAddress));
    } else {
      uninitialized.push(new InitializerHelper(provider, chainID, poolData as UninitializedPool, userAddress));
    }
  }
  return { initialized, uninitialized };
}

export async function getAllHelpersFromCache(provider_: any, userAddress?: string): Promise<{
  initialized: PoolHelper[],
  uninitialized: InitializerHelper[],
}> {
  const provider = toProvider(provider_);
  const chainID = (await provider.getNetwork()).chainId;
  let url = (chainID == 1) ? INDEXED_SUBGRAPH_URL : INDEXED_RINKEBY_SUBGRAPH_URL;
  let poolDatas;
  if (chainID == 1) {
    const { indexPools } = require('./cache/mainnet-pools.json');
    poolDatas = parsePoolData(indexPools);
  } else {
    poolDatas = await getPools(url);
  }
  const initialized: PoolHelper[] = [];
  const uninitialized: InitializerHelper[] = [];
  for (let poolData of poolDatas) {
    if (poolData.isPublic) {
      initialized.push(new PoolHelper(provider, chainID, poolData, userAddress));
    } else {
      uninitialized.push(new InitializerHelper(provider, chainID, poolData as UninitializedPool, userAddress));
    }
  }
  return { initialized, uninitialized };
}