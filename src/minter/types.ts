import { BestTradeOptions, TokenAmount } from '@uniswap/sdk';
import { TokenAmount as IndexedJSTokenAmount } from '../pool-helper';

export type TokenInput = {
  address: string;
  name?: string;
  symbol?: string;
};

export type MintOptions = BestTradeOptions & {
  slippage?: number
};

export type IndexedJSTokenAmountWithCost = IndexedJSTokenAmount & { cost: number };

export type MintParams_ExactETHForTokensAndMint = {
  fn: 'swapExactETHForTokensAndMint';
  path: string[];
  ethInput: IndexedJSTokenAmount;
  minPoolOutput: IndexedJSTokenAmount;
};

export type MintParams_ExactTokensForTokensAndMint = {
  fn: 'swapExactTokensForTokensAndMint';
  path: string[];
  tokenInput: IndexedJSTokenAmount;
  minPoolOutput: IndexedJSTokenAmount;
};

export type MintParams_EthForTokensAndMintExact = {
  fn: 'swapETHForTokensAndMintExact';
  maxEthInput: IndexedJSTokenAmount;
  poolOutput: IndexedJSTokenAmount;
  path: string[];
};


export type MintParams_TokensForTokensAndMintExact = {
  fn: 'swapTokensForTokensAndMintExact';
  maxTokenInput: IndexedJSTokenAmount;
  poolOutput: IndexedJSTokenAmount;
  path: string[];
};

export type MintParams_TokensForAllTokensAndMintExact = {
  fn: 'swapTokensForAllTokensAndMintExact';
  maxTokenInput: IndexedJSTokenAmount;
  poolOutput: IndexedJSTokenAmount;
};

export type MintParams_EthForAllTokensAndMintExact = {
  fn: 'swapETHForAllTokensAndMintExact';
  maxEthInput: IndexedJSTokenAmount;
  poolOutput: IndexedJSTokenAmount;
};

export type MintParams = MintParams_ExactETHForTokensAndMint |
  MintParams_ExactTokensForTokensAndMint |
  MintParams_EthForTokensAndMintExact |
  MintParams_TokensForTokensAndMintExact |
  MintParams_TokensForAllTokensAndMintExact |
  MintParams_EthForAllTokensAndMintExact;