import { Fetcher, Token, Pair, BigintIsh } from '@uniswap/sdk';
import { Provider } from '@ethersproject/providers';
import { getAddress } from 'ethers/lib/utils';
import { getWethAddress } from '../constants';

export type TokenInput = {
  address: string;
  decimals: number;
  name: string;
  symbol: string;
};

export function toTokens(chainID: number, tokenInputs: TokenInput[]): Token[] {
  const tokens = [];
  for (let token of tokenInputs) {
    tokens.push(
      new Token(chainID, getAddress(token.address), token.decimals, token.symbol, token.name)
    );
  }
  return tokens;
}

export const bigintToHex = (amount: BigintIsh) => {
  return '0x' + amount.toString(16);
}

export function getPair(provider: Provider, tokenA: Token, tokenB: Token): Promise<Pair | void> {
  if (tokenA.sortsBefore(tokenB)) {
    return Fetcher.fetchPairData(tokenA, tokenB, provider as any).catch(() => {})
  } else {
    return Fetcher.fetchPairData(tokenB, tokenA, provider as any).catch(() => {})
  }
}

export function getUniswapWethType(chainID: number): Token {
  const address = getWethAddress(chainID);
  return new Token(chainID, address, 18, 'WETH', 'WETH9');
}