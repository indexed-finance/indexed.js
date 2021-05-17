import {
  IndexedStakingSubgraphClient,
  IndexedCoreSubgraphClient
} from '@indexed-finance/subgraph-clients';
import {
  IndexPoolData,
  DailyPoolSnapshotPartialData,
  NdxStakingPoolData,
} from '@indexed-finance/subgraph-clients/dist/core/types';
import { AllStakingInfoData } from '@indexed-finance/subgraph-clients/dist/staking/types'
import * as bmath from './bmath';
import { Pool, PoolDailySnapshot, StakingPool, Token } from './types';
import { BigNumber } from './utils/bignumber';

export async function getPools(network: 'mainnet' | 'rinkeby'): Promise<Pool[]> {
  const client = IndexedCoreSubgraphClient.forNetwork(network)
  const indexPools = await client.getAllIndexPools()
  return indexPools.map(parsePool);
}

export async function getPool(network: 'mainnet' | 'rinkeby', address: string): Promise<Pool> {
  const client = IndexedCoreSubgraphClient.forNetwork(network)
  const indexPool = await client.getIndexPool(address)
  const pool = parsePool(indexPool)
  return pool;
}

const toBaseToken = (t): Token => ({
  address: t.token.id,
  balance: bmath.bnum(t.balance),
  decimals: +(t.token.decimals),
  name: t.token.name,
  symbol: t.token.symbol,
  priceUSD: +(t.token.priceUSD)
});

// const tokenDayDataQuery = (tokenAddress, days) => `
// {
  // tokenDayDatas(orderBy: date, orderDirection: desc, first: ${days}, where: { token: "${tokenAddress}" }) {
    // date
    // priceUSD
  // }
// }
// `

export async function getTokenPrice(network: 'mainnet' | 'rinkeby', address: string): Promise<BigNumber> {
  return bmath.bnum(0);
}

export async function getPoolSnapshots(network: 'mainnet' | 'rinkeby', poolAddress: string, days: number): Promise<PoolDailySnapshot[]> {
  const client = IndexedCoreSubgraphClient.forNetwork(network)
  const dailyPoolSnapshots = await client.getPoolSnapshots(poolAddress, days)
  return parsePoolSnapshots(dailyPoolSnapshots);
}

export async function getStakingPools(network: 'mainnet' | 'rinkeby'): Promise<StakingPool[]> {
  const client = IndexedCoreSubgraphClient.forNetwork(network)
  const ndxStakingPools = await client.getAllStakingPools()
  // const { ndxStakingPools } = await executeQuery(stakingQuery(), url);
  return ndxStakingPools.map(parseStakingPool);
}

export async function getPoolUpdate(network: 'mainnet' | 'rinkeby', address: string): Promise<PoolUpdate> {
  const client = IndexedCoreSubgraphClient.forNetwork(network)
  const result = await client.getPoolUpdate(network)
  return {
    snapshot: {
      ...result.snapshot,
      totalSupply: +result.snapshot.totalSupply
    },
    tokenPrices: result.tokenPrices
  };
}

export const getNewStakingInfo = async (network: 'mainnet' | 'rinkeby'): Promise<AllStakingInfoData> => {
  const client = IndexedStakingSubgraphClient.forNetwork(network);
  return client.getStakingInfo();
}

export const parsePoolSnapshots = (snapshots_: DailyPoolSnapshotPartialData[]): PoolDailySnapshot[] => {
  let snapshots = snapshots_.reverse();
  let retArr: PoolDailySnapshot[] = [];
  let snapshot0 = snapshots[0];
  let lastDate = +(snapshot0.date);
  let lastSwapVolumeTotal = snapshot0.totalSwapVolumeUSD;
  let lastVolumeTotal = snapshot0.totalVolumeUSD;
  let lastFeesTotal = snapshot0.feesTotalUSD;
  let lastSupply = +(snapshot0.totalSupply);
  let lastValue = snapshot0.value;
  let lastTotalValue = snapshot0.totalValueLockedUSD
  if (snapshots_.length == 1) {
    retArr.push({
      date: lastDate,
      value: snapshot0.value,
      totalSupply: +(snapshot0.totalSupply),
      dailyFeesUSD: lastFeesTotal,
      totalVolumeUSD: lastVolumeTotal,
      totalValueLockedUSD: snapshot0.totalValueLockedUSD,
      dailySwapVolumeUSD: lastSwapVolumeTotal
    });
  } else {
    for (let snapshot of snapshots.slice(1)) {
      const {
        date,
        value,
        totalSupply,
        feesTotalUSD,
        totalValueLockedUSD,
        totalSwapVolumeUSD,
        totalVolumeUSD
      } = snapshot;

      let dailyFeesUSD = (+feesTotalUSD) - lastFeesTotal;
      let dailySwapVolumeUSD = (+totalSwapVolumeUSD) - lastSwapVolumeTotal;
      let dailyVolumeUSD = (+totalVolumeUSD) - lastVolumeTotal;
      let diff = (+date) - (lastDate);
      if (diff > 3600) {
        let numHours = (diff / 3600) - 1;
        let feesEachHour = dailyFeesUSD / numHours;
        let swapVolumeEachHour = dailySwapVolumeUSD / numHours;
        let supplyEachHour = (+totalSupply - lastSupply) / numHours;
        let volumeEachHour = dailyVolumeUSD / numHours;
        let valueEachHour = (+value - lastValue) / numHours;
        let tvlEachHour = (+totalValueLockedUSD - lastTotalValue) / numHours;
        for (let i = 1; i <= numHours; i++) {
          retArr.push({
            date: lastDate + (3600 * i),
            value: lastValue + (valueEachHour * i),
            totalSupply: lastSupply + (supplyEachHour * i),
            dailyFeesUSD: (feesEachHour * i),
            totalValueLockedUSD: lastTotalValue + (tvlEachHour * i),
            dailySwapVolumeUSD: (swapVolumeEachHour * i),
            totalVolumeUSD: (volumeEachHour * i)
          });
        }
      }
      lastFeesTotal = +feesTotalUSD;
      lastSwapVolumeTotal = +totalSwapVolumeUSD;
      lastVolumeTotal = +totalVolumeUSD;
      lastSupply = +totalSupply;
      lastValue = +value;
      lastDate = +date;
      lastTotalValue = +totalValueLockedUSD

      retArr.push({
        date: +date,
        value: +value,
        totalSupply: +totalSupply,
        dailyFeesUSD: +dailyFeesUSD,
        totalValueLockedUSD: +totalValueLockedUSD,
        dailySwapVolumeUSD: +dailySwapVolumeUSD,
        totalVolumeUSD: +dailyVolumeUSD
      });
    }
  }
  retArr.sort((a, b) => a.date - b.date);
  return retArr;
}

export const parseStakingPool = (data: NdxStakingPoolData): StakingPool => {
  const periodStart =  data.startsAt;
  const periodFinish = data.periodFinish;
  const lastUpdateTime = data.lastUpdateTime;
  const timestamp = new Date().getTime() / 1000;
  return {
    address: data.id,
    indexPool: data.indexPool,
    stakingToken: data.stakingToken,
    isWethPair: data.isWethPair,
    periodStart,
    periodFinish,
    lastUpdateTime,
    totalRewards: bmath.bnum(data.totalRewards),
    claimedRewards: bmath.bnum(data.claimedRewards),
    rewardRate: bmath.bnum(data.rewardRate),
    rewardPerToken: bmath.bnum(data.rewardPerTokenStored),
    totalSupply: bmath.bnum(data.totalSupply),
    isReady: data.isReady || timestamp >= periodStart,
    hasBegun: data.isReady,
    active: data.isReady && periodFinish > lastUpdateTime
  };
};

export const parsePool = (p: IndexPoolData): Pool => {
  let obj: any = {
    category: p.category.id,
    address: p.id,
    name: p.name,
    symbol: p.symbol,
    size: p.size,
    isPublic: p.isPublic,
    totalSupply: bmath.bnum(p.totalSupply),
    totalVolumeUSD: bmath.bnum(p.totalVolumeUSD),
    totalWeight: bmath.bnum(p.totalWeight),
    swapFee: p.isPublic ? bmath.scale(bmath.bnum(p.swapFee), 18) : bmath.bnum(0),
    exitFee: bmath.scale(bmath.bnum(p.exitFee), 18)
  };
  if (p.isPublic) {
    let tokenIndices = p.tokensList.reduce((tks, address, i) => ({
      ...tks, [address]: i
    }), {});
    obj.feesTotalUSD = p.feesTotalUSD;
    obj.totalValueLockedUSD = p.totalValueLockedUSD;
    obj.totalSwapVolumeUSD = p.totalSwapVolumeUSD;
    obj.tokens = new Array(p.tokens.length).fill(null);
    obj.initializer = p.poolInitializer.id;
    obj.snapshots = parsePoolSnapshots(p.dailySnapshots);
    p.tokens.forEach((t) => {
      let token: any = {
        ...toBaseToken(t),
        ready: t.ready,
        balance: bmath.bnum(t.balance),
        usedBalance: t.ready ? bmath.bnum(t.balance) : bmath.bnum(t.minimumBalance),
        weight: bmath.scale(
          bmath.bnum(t.denorm).div(obj.totalWeight),
          18
        ),
        denorm: bmath.bnum(t.denorm),
        desiredWeight: bmath.scale(
          bmath.bnum(t.desiredDenorm).div(obj.totalWeight),
          18
        ),
        desiredDenorm: bmath.bnum(t.desiredDenorm),
      };
      if (token.ready) {
        token.usedDenorm = token.denorm;
        token.usedWeight = token.weight;
      } else {
        token.usedDenorm = bmath.MIN_WEIGHT;
        token.usedWeight = bmath.bnum(bmath.MIN_WEIGHT).div(obj.totalWeight);
      }
      if (t.minimumBalance) {
        token.minimumBalance = bmath.bnum(token.usedBalance);
      }
      let index = tokenIndices[token.address];
      obj.tokens[index] = token;
    });
  } else {
    obj.initializer = {
      address: p.poolInitializer.id,
      pool: obj.address,
      totalCreditedWETH: bmath.bnum(p.poolInitializer.totalCreditedWETH),
      tokens: []
    };
    p.poolInitializer.tokens.forEach((t) => {
      obj.initializer.tokens.push({
        ...toBaseToken(t),
        targetBalance: bmath.bnum(t.targetBalance),
        amountRemaining: bmath.bnum(t.amountRemaining)
      })
    });
  }
  return obj;
}

type PoolUpdate = {
  snapshot: PoolDailySnapshot;
  tokenPrices: { [address: string]: number }
}