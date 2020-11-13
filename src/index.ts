import { getPools } from './subgraph';
export * from './multicall';
import * as bmath from './bmath';
import { UninitializedPool } from './types';
import { PoolHelper } from './pool-helper';
import { InitializerHelper } from './initializer-helper';
export * from './utils/bignumber';
export { bmath, getPools, PoolHelper };
export { UniswapHelper } from './uniswap-helper';

export async function getAllHelpers(provider: any, userAddress?: string): Promise<{
  initialized: PoolHelper[],
  uninitialized: InitializerHelper[],
}> {
  const poolDatas = await getPools();
  const initialized: PoolHelper[] = [];
  const uninitialized: InitializerHelper[] = [];
  for (let poolData of poolDatas) {
    if (poolData.isPublic) {
      initialized.push(new PoolHelper(provider, poolData, userAddress));
    } else {
      uninitialized.push(new InitializerHelper(provider, poolData as UninitializedPool, userAddress));
    }
  }
  return { initialized, uninitialized };
}