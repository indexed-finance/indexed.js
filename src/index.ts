import { getPools } from './subgraph';
export * from './multicall';
import * as bmath from './bmath';
import { Pool } from './types';
import { PoolHelper } from './pool-helper';
export { bmath, getPools, PoolHelper };

export async function getAllHelpers(provider: any): Promise<{
  initialized: PoolHelper[],
  uninitialized: Pool[]
}> {
  const poolDatas = await getPools();
  const initialized: PoolHelper[] = [];
  const uninitialized: Pool[] = [];
  for (let poolData of poolDatas) {
    if (poolData.isPublic) {
      initialized.push(new PoolHelper(provider, poolData));
    } else {
      uninitialized.push(poolData);
    }
  }
  return { initialized, uninitialized };
}