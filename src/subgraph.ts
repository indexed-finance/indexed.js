import fetch from 'isomorphic-fetch';
import * as bmath from './bmath';
import { Pool, PoolDailySnapshot, Token } from './types';
import { BigNumber } from './utils/bignumber';

const INDEXED_SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/indexed-finance/indexed-v1';
const UNISWAP_SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2';
const UNISWAP_SUBGRAPH_URL_RINKEBY = 'https://api.thegraph.com/subgraphs/name/samgos/uniswap-v2-rinkeby';

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
maxTotalSupply
swapFee
feesTotalUSD
totalValueLockedUSD
totalSwapVolumeUSD
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
  denorm
  desiredDenorm
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

export async function getPools(): Promise<Pool[]> {
  const query = `
    {
      indexPools (first: 1000) {
        ${poolQuery}
      }
    }
  `;

  const { indexPools } = await executeQuery(query)
  return parsePoolData(indexPools);
}

export async function getPool(address: string): Promise<Pool> {
  const query = `
    {
      indexPool(id: "${address}") {
        ${poolQuery}
      }
    }
  `;

  const { indexPool } = await executeQuery(query)
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
      category: +(p.category.id),
      address: p.id,
      name: p.name,
      symbol: p.symbol,
      size: p.size,
      isPublic: p.isPublic,
      totalSupply: bmath.bnum(p.totalSupply),
      maxTotalSupply: bmath.bnum(p.maxTotalSupply),
      totalWeight: bmath.bnum(p.totalWeight),
      swapFee: p.isPublic ? bmath.scale(bmath.bnum(p.swapFee), 18) : bmath.bnum(0),
    };
    if (p.isPublic) {
      obj.feesTotalUSD = p.feesTotalUSD;
      obj.totalValueLockedUSD = p.totalValueLockedUSD;
      obj.totalSwapVolumeUSD = p.totalSwapVolumeUSD;
      obj.tokens = [];
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
          token.minimumBalance = bmath.bnum(token.minimumBalance);
        }
        obj.tokens.push(token);
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

export async function getTokenPrice(address: string): Promise<BigNumber> {
  const { tokenDayDatas } = await executeQuery(tokenDayDataQuery(address, 1), UNISWAP_SUBGRAPH_URL_RINKEBY);
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
  }
}
`

export async function getPoolSnapshots(poolAddress: string, days: number): Promise<PoolDailySnapshot[]> {
  const { dailyPoolSnapshots } = await executeQuery(poolSnapshotsQuery(poolAddress, days + 1), INDEXED_SUBGRAPH_URL);
  return parsePoolSnapshots(dailyPoolSnapshots);
}

export const parsePoolSnapshots = (snapshots_): PoolDailySnapshot[] => {
  let snapshots = snapshots_.reverse();
  let retArr: PoolDailySnapshot[] = [];
  let snapshot0 = snapshots[0];
  let lastDate = +(snapshot0.date);
  let lastSwapVolumeTotal = +(snapshot0.totalSwapVolumeUSD);
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
        totalSwapVolumeUSD
      } = snapshot;
      
      let dailyFeesUSD = (+feesTotalUSD) - lastFeesTotal;
      let dailySwapVolumeUSD = (+totalSwapVolumeUSD) - lastSwapVolumeTotal;
      let diff = (+date) - (lastDate);
      if (diff > 3600) {
        let numHours = (diff / 3600) - 1;
        let feesEachHour = dailyFeesUSD / numHours;
        let volumeEachHour = dailySwapVolumeUSD / numHours;
        let supplyEachHour = (+totalSupply - lastSupply) / numHours;
        let valueEachHour = (+value - lastValue) / numHours;
        let tvlEachHour = (+totalValueLockedUSD - lastTotalValue) / numHours;
        for (let i = 1; i <= numHours; i++) {
          retArr.push({
            date: lastDate + (3600 * i),
            value: lastValue + (valueEachHour * i),
            totalSupply: lastSupply + (supplyEachHour * i),
            dailyFeesUSD: (feesEachHour * i),
            totalValueLockedUSD: lastTotalValue + (tvlEachHour * i),
            dailySwapVolumeUSD: (volumeEachHour * i)
          });
        }
      }
      lastFeesTotal = +feesTotalUSD;
      lastSwapVolumeTotal = +totalSwapVolumeUSD;
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
        dailySwapVolumeUSD: +dailySwapVolumeUSD
      });
    }

  }
  return retArr;
}