import Web3 from 'web3';
import { Contract } from 'web3-eth-contract';
import { Web3Provider } from '@ethersproject/providers'
import ganache from 'ganache-core';
import { BigNumber, toWei } from '../src/utils/bignumber';
import { InitializedPool } from '../src/types';
import { bdiv } from '../src/bmath';
const server = ganache.server({ gasLimit: 20000000  });
const web3 = new Web3(server.provider as any);

const provider = new Web3Provider(web3.currentProvider as any);

export type TestToken = {
  address: string;
  symbol: string;
  name: string;
  weight: BigNumber;
  denorm: BigNumber;
  balance: BigNumber;
  token: Contract;
}

export async function createPool() {
  const ipoolArtifact = require('./artifacts/IPool.json');
  const mockErc20Artifact = require('./artifacts/MockERC20.json');
  const tokens: TestToken[]  = [];
  const [from] = await web3.eth.getAccounts();
  const MockERC20 = new web3.eth.Contract(mockErc20Artifact.abi);
  const totalWeight = toWei(15);
  for (let i = 0; i < 5; i++) {
    const token = await MockERC20.deploy({
      data: mockErc20Artifact.bytecode,
      arguments: [`Token ${i}`, `TK${i}`]
    }).send({ from, gas: 5e6 });
    const balance = toWei((i + 5).toString());
    const denorm = toWei((i + 1).toString());
    await token.methods.getFreeTokens(from, balance).send({ from, gas: 5e6 });
    tokens.push({
      symbol: `TK${i}`,
      name: `Token ${i}`,
      address: token.options.address,
      token,
      balance,
      denorm,
      weight: bdiv(denorm, totalWeight)
    });
  }
  const IPool = new web3.eth.Contract(ipoolArtifact.abi);
  const pool = await IPool.deploy({ data: ipoolArtifact.bytecode }).send({ from, gas: 7e6 });
  for (let token of tokens) {
    await token.token.methods.approve(pool.options.address, token.balance).send({ from, gas: 5e6 });
  }
  await pool.methods.configure(from, 'Pool', 'Pool').send({ from, gas: 5e6 });
  await pool.methods.initialize(
    tokens.map(t => t.address),
    tokens.map(t => t.balance),
    tokens.map(t => t.denorm),
    from,
    from
  ).send({ from, gas: 7e6 });

  const poolInfo: InitializedPool = {
    address: pool.options.address,
    name: 'Pool',
    symbol: 'Pool',
    size: 5,
    isPublic: true,
    totalWeight: toWei(15),
    totalSupply: toWei(100),
    maxTotalSupply: new BigNumber(0),
    swapFee: toWei('0.025'),
    tokens: tokens.map((t, i) => ({
      ready: true,
      address: t.address,
      decimals: 18,
      balance: t.balance,
      usedBalance: t.balance,
      weight: t.weight,
      usedWeight: t.weight,
      desiredWeight: t.weight,
      denorm: t.denorm,
      usedDenorm: t.denorm,
      desiredDenorm: t.denorm,
      name: t.name,
      symbol: t.symbol
    }))
  }
  return {
    pool,
    tokens,
    from,
    poolInfo
  }
}



export { web3, provider };