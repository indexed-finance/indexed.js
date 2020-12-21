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
/*   function swapTokensForAllTokensAndMintExact(
    address tokenIn,
    uint256 amountInMax,
    address[] calldata intermediaries,
    address indexPool,
    uint256 poolAmountOut
  ) external returns (uint256 amountInTotal) {
  function swapETHForAllTokensAndMintExact(
    address indexPool,
    address[] calldata intermediaries,
    uint256 poolAmountOut
  ) external payable returns (uint amountInTotal) { */

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
  intermediaries: string[];
};

export type MintParams_EthForAllTokensAndMintExact = {
  fn: 'swapETHForAllTokensAndMintExact';
  maxEthInput: IndexedJSTokenAmount;
  poolOutput: IndexedJSTokenAmount;
  intermediaries: string[];
};

export type MintParams = MintParams_ExactETHForTokensAndMint |
  MintParams_ExactTokensForTokensAndMint |
  MintParams_EthForTokensAndMintExact |
  MintParams_TokensForTokensAndMintExact |
  MintParams_TokensForAllTokensAndMintExact |
  MintParams_EthForAllTokensAndMintExact;