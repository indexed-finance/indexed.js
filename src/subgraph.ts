import fetch from 'isomorphic-fetch';
import * as bmath from './bmath';
import { Pool, PoolDailySnapshot, StakingPool, Token } from './types';
import { BigNumber } from './utils/bignumber';

export const INDEXED_SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/indexed-finance/indexed';
export const INDEXED_RINKEBY_SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/indexed-finance/indexed-rinkeby';
export const UNISWAP_SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2';
export const UNISWAP_SUBGRAPH_URL_RINKEBY = 'https://api.thegraph.com/subgraphs/name/samgos/uniswap-v2-rinkeby';

const poolQuery = `
id
category {
  id
}
size
name
symbol
isPublic
totalSupply
totalWeight
swapFee
exitFee
feesTotalUSD
totalValueLockedUSD
totalVolumeUSD
totalSwapVolumeUSD
tokensList
poolInitializer {
  id
  totalCreditedWETH
  tokens {
    token {
      id
      decimals
      name
      symbol
      priceUSD
    }
    balance
    targetBalance
    amountRemaining
  }
}
tokens {
  id
  token {
    id
    decimals
    name
    symbol
    priceUSD
  }
  ready
  balance
  minimumBalance
  denorm
  desiredDenorm
}
dailySnapshots(orderBy: date, orderDirection: desc, first: 90) {
  id
  date
  value
  totalSupply
  feesTotalUSD
  totalValueLockedUSD
  totalSwapVolumeUSD
  totalVolumeUSD
}
`;

const executeQuery = async (query: string, url: string = INDEXED_SUBGRAPH_URL): Promise<any> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query
    }),
  });
  const { data } = await response.json();
  return data;
}

export async function getPools(url: string): Promise<Pool[]> {
  const query = `
    {
      indexPools (first: 1000) {
        ${poolQuery}
      }
    }
  `;

  const { indexPools } = await executeQuery(query, url)
  return parsePoolData(indexPools);
}

export async function getPool(url: string, address: string): Promise<Pool> {
  const query = `
    {
      indexPool(id: "${address}") {
        ${poolQuery}
      }
    }
  `;

  const { indexPool } = await executeQuery(query, url)
  const [pool] = await parsePoolData([ indexPool ]);
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

export const parsePoolData = (
  pools
): Pool[] => {
  let poolData: Pool[] = [];
  pools.forEach((p) => {
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
    poolData.push(obj);
  });

  return poolData;
};

const tokenDayDataQuery = (tokenAddress, days) => `
{
  tokenDayDatas(orderBy: date, orderDirection: desc, first: ${days}, where: { token: "${tokenAddress}" }) {
    date
    priceUSD
  }
}
`

export async function getTokenPrice(url: string, address: string): Promise<BigNumber> {
  const { tokenDayDatas } = await executeQuery(tokenDayDataQuery(address, 1), url);
  const tokenDayData = tokenDayDatas[0];
  return bmath.bnum(tokenDayData.priceUSD);
}

const poolSnapshotsQuery = (poolAddress: string, days: number) => `
{
  dailyPoolSnapshots(orderBy: date, orderDirection: desc, first: ${days}, where: { pool: "${poolAddress}" }) {
    id
    date
    value
    totalSupply
    feesTotalUSD
    totalValueLockedUSD
    totalSwapVolumeUSD
    totalVolumeUSD
  }
}
`

export async function getPoolSnapshots(url: string, poolAddress: string, days: number): Promise<PoolDailySnapshot[]> {
  const { dailyPoolSnapshots } = await executeQuery(poolSnapshotsQuery(poolAddress, days + 1), url);
  return parsePoolSnapshots(dailyPoolSnapshots);
}

export const parsePoolSnapshots = (snapshots_): PoolDailySnapshot[] => {
  let snapshots = snapshots_.reverse();
  let retArr: PoolDailySnapshot[] = [];
  let snapshot0 = snapshots[0];
  let lastDate = +(snapshot0.date);
  let lastSwapVolumeTotal = +(snapshot0.totalSwapVolumeUSD);
  let lastVolumeTotal = +(snapshot0.totalVolumeUSD);
  let lastFeesTotal = +(snapshot0.feesTotalUSD);
  let lastSupply = +(snapshot0.totalSupply);
  let lastValue = +(snapshot0.value);
  let lastTotalValue = +(snapshot0.totalValueLockedUSD)
  if (snapshots_.length == 1) {
    retArr.push({
      date: lastDate,
      value: +(snapshot0.value),
      totalSupply: +(snapshot0.totalSupply),
      dailyFeesUSD: lastFeesTotal,
      totalVolumeUSD: lastVolumeTotal,
      totalValueLockedUSD: +(snapshot0.totalValueLockedUSD),
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

const stakingQuery = () => `
{
  ndxStakingPools(first: 20) {
    id
    isWethPair
    startsAt
		isReady
    indexPool
    stakingToken
    totalSupply
    periodFinish
    lastUpdateTime
    totalRewards
    claimedRewards
    rewardRate
    rewardPerTokenStored
  }
}
`;

export async function getStakingPools(url: string): Promise<StakingPool[]> {
  const { ndxStakingPools } = await executeQuery(stakingQuery(), url);
  return ndxStakingPools.map(parseStakingPool);
}

export const parseStakingPool = (data: any): StakingPool => {
  const periodStart =  +(data.startsAt);
  const periodFinish = +(data.periodFinish);
  const lastUpdateTime = +(data.lastUpdateTime);
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

const poolUpdateQuery = (address: string) => `
{
  indexPool(id: "${address}") {
    dailySnapshots(orderBy: date, orderDirection: desc, first: 1) {
      id
      date
      value
      totalSupply
      feesTotalUSD
      totalValueLockedUSD
      totalSwapVolumeUSD
      totalVolumeUSD
    }
    tokens {
      token {
        id
        priceUSD
      }
    }
  }
}
`;

type PoolUpdate = {
  snapshot: PoolDailySnapshot;
  tokenPrices: { [address: string]: number }
}

export async function getPoolUpdate(url: string, address: string): Promise<PoolUpdate> {
  const query = poolUpdateQuery(address.toLowerCase());
  const { indexPool: { dailySnapshots, tokens } } = await executeQuery(query, url);
  const [snapshot] = parsePoolSnapshots(dailySnapshots);
  const tokenPrices = tokens.reduce(
    (obj, t) => ({ ...obj, [t.token.id]: +(t.token.priceUSD) }),
    {}
  );
  return {
    snapshot,
    tokenPrices
  };
}