import { getPools, getStakingPools, INDEXED_RINKEBY_SUBGRAPH_URL, INDEXED_SUBGRAPH_URL } from './subgraph';
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

export async function getStakingHelpers(provider_: any, userAddress?: string): Promise<StakingPoolHelper[]> {
  const provider = toProvider(provider_);
  const chainID = (await provider.getNetwork()).chainId;
  let url = (chainID == 1) ? INDEXED_SUBGRAPH_URL : INDEXED_RINKEBY_SUBGRAPH_URL;
  const stakingPools = await getStakingPools(url);
  return stakingPools.map((pool) => new StakingPoolHelper(provider, chainID, pool, userAddress));
}