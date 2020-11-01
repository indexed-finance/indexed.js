import fetch from 'isomorphic-fetch';
import * as bmath from './bmath';
import { Pool, Token } from './types';

const SUBGRAPH_URL = 'https://api.thegraph.com/subgraphs/name/indexed-finance/indexed-v1';

const poolQuery = `
id
size
name
symbol
isPublic
totalSupply
totalWeight
maxTotalSupply
swapFee
poolInitializer {
  id
  totalCreditedWETH
  tokens {
    address
    decimals
    name
    symbol
    balance
    amountRemaining
  }
}
tokens {
  ready
  address
  balance
  decimals
  name
  symbol
  denorm
  desiredDenorm
}
`;

const executeQuery = async (query: string): Promise<any> => {
  const response = await fetch(SUBGRAPH_URL, {
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
  address: t.address,
  balance: bmath.bnum(t.balance),
  decimals: +t.decimals,
  name: t.name,
  symbol: t.symbol
});

export const parsePoolData = (
  pools
): Pool[] => {
  let poolData: Pool[] = [];
  pools.forEach((p) => {
    let obj: any = {
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
          amountRemaining: bmath.bnum(t.amountRemaining)
        })
      });
    }
    poolData.push(obj);
  });

  return poolData;
};