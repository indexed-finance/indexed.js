import { Contract } from "ethers";
import { Provider } from "@ethersproject/providers";


import { BigNumber, toBN, toTokenAmount } from "./utils/bignumber";
import deployments from './deployments';
import { computeUniswapPairAddress, sortTokens } from "./utils/address";
import { toProvider } from "./utils/provider";
const PairABI = require('./abi/Pair.json');

type Token = {
  address: string;
  decimals: number;
}

// Returns [tokenAReserves, tokenBReserves]
export async function getReserves(provider: Provider, tokenA: Token, tokenB: Token): Promise<BigNumber[]> {
  const pairAddress = computeUniswapPairAddress(tokenA.address, tokenB.address);
  const pair = new Contract(pairAddress, PairABI, provider);
  const [reserves0, reserves1] = await pair.getReserves();
  if (tokenA.address < tokenB.address) {
    return [toTokenAmount(reserves0, tokenA.decimals), toTokenAmount(reserves1, tokenB.decimals)];
  } else {
    return [toTokenAmount(reserves1, tokenA.decimals), toTokenAmount(reserves0, tokenB.decimals)];
  }
}

// Returns price of `token` in terms of `quoteToken`
export async function getTokenPrice(
  provider_: any,
  token: Token,
  quoteToken: Token
): Promise<BigNumber> {
  const provider = toProvider(provider_);
  const [tokenReserves, quoteReserves] = await getReserves(provider, token, quoteToken);
  return quoteReserves.div(tokenReserves);
}

// Returns the price of DAI in terms of ether
export async function getDaiPriceEth(provider_: any): Promise<BigNumber> {
  const provider = toProvider(provider_);
  const network = await provider.getNetwork().then(n => n.name);
  const { weth, dai } = deployments[network];
  return getTokenPrice(provider_, { address: dai, decimals: 18 }, { address: weth, decimals: 18 });
}

// Returns the price of ether in terms of DAI
export async function getEthPriceDai(provider_: any): Promise<BigNumber> {
  const provider = toProvider(provider_);
  const network = await provider.getNetwork().then(n => n.name);
  const { weth, dai } = deployments[network];
  return getTokenPrice(provider_, { address: weth, decimals: 18 }, { address: dai, decimals: 18 });
}

// Return the price of `token` in terms of ether
export async function getTokenPriceEth(provider_: any, token: string, decimals: number = 18): Promise<BigNumber> {
  const provider = toProvider(provider_);
  const network = await provider.getNetwork().then(n => n.name);
  const { weth } = deployments[network];
  return getTokenPrice(provider_, { address: token, decimals }, { address: weth, decimals: 18 });
}

// Return the price of `token` in terms of DAI
export async function getTokenPriceUSD(provider_: any, token: string, decimals: number = 18): Promise<BigNumber> {
  const ethPriceDai = await getEthPriceDai(provider_);
  const tokenPriceEth = await getTokenPriceEth(provider_, token, decimals);
  return tokenPriceEth.times(ethPriceDai);
}

type Pair = {
  pairAddress: string;
  pairedTokenAddress: string;
}

export async function getAllTokenPairs(provider_: any, token: string, whitelist: string[]): Promise<Pair[]> {
  const provider = toProvider(provider_);
  const proms: Promise<Pair | null>[] = whitelist.map((tokenB) => {
    const pairAddress = computeUniswapPairAddress(token, tokenB);
    console.log(pairAddress)
    return provider.getCode(pairAddress).then((c) => {
      if (!c || c === '0x') return null;
      return {
        pairAddress,
        pairedTokenAddress: tokenB
      };
    })
  });
  return (await Promise.all(proms)).filter(p => p);
}