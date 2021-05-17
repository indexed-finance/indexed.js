import { getPools, getStakingPools } from './subgraph';
export * from './multicall';
import * as bmath from './bmath';
import { UninitializedPool } from './types';
import { PoolHelper } from './pool-helper';
import { InitializerHelper } from './initializer-helper';
import { toProvider } from './utils/provider';
export * from './utils/bignumber';
export { bmath, getPools, PoolHelper };
export { UniswapHelper } from './uniswap-helper';
import { StakingPoolHelper } from './staking';
export { StakingPoolHelper };

export async function getAllHelpers(provider_: any, userAddress?: string): Promise<{
  initialized: PoolHelper[],
  uninitialized: InitializerHelper[],
}> {
  const provider = toProvider(provider_);
  const network = (await provider.getNetwork()).name as 'mainnet' | 'rinkeby';
  const poolDatas = await getPools(network);
  const initialized: PoolHelper[] = [];
  const uninitialized: InitializerHelper[] = [];
  for (let poolData of poolDatas) {
    if (poolData.isPublic) {
      initialized.push(new PoolHelper(provider, network, poolData, userAddress));
    } else {
      uninitialized.push(new InitializerHelper(provider, network, poolData as UninitializedPool, userAddress));
    }
  }
  return { initialized, uninitialized };
}

export async function getStakingHelpers(provider_: any, userAddress?: string): Promise<StakingPoolHelper[]> {
  const provider = toProvider(provider_);
  const network = (await provider.getNetwork()).name as 'mainnet' | 'rinkeby';
  const stakingPools = await getStakingPools(network);
  return stakingPools.map((pool) => new StakingPoolHelper(provider, network, pool, userAddress));
}