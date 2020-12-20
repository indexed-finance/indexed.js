import { Fetcher, Trade, TokenAmount, Token, Pair, BigintIsh, BestTradeOptions, Fraction, JSBI } from '@uniswap/sdk';
import { Provider } from '@ethersproject/providers';
import { getAddress } from 'ethers/lib/utils';
import { PoolHelper, TokenAmount as IndexedJSTokenAmount  } from '../pool-helper';
import { toBN, formatBalance, toHex, BigNumber } from '../utils/bignumber';
import { toProvider } from '../utils/provider';
import { PoolToken } from '../types';

const ONE = JSBI.BigInt(1);

import {
  MintParams_TokensForAllTokensAndMintExact,
  MintParams_EthForAllTokensAndMintExact,
  MintParams_TokensForTokensAndMintExact,
  MintParams_ExactTokensForTokensAndMint,
  MintParams_EthForTokensAndMintExact, MintParams_ExactETHForTokensAndMint
} from './types';
import { getTokenUserData } from '../multicall';

export type TokenInput = {
  address: string;
  decimals: number;
  name: string;
  symbol: string;
};

export type MintOptions = BestTradeOptions & {
  slippage?: number
};

export type IndexedJSTokenAmountWithCost = IndexedJSTokenAmount & { cost: number };

function toTokens(chainID: number, tokenInputs: TokenInput[]): Token[] {
  const tokens = [];
  for (let token of tokenInputs) {
    tokens.push(
      new Token(chainID, getAddress(token.address), token.decimals, token.symbol, token.name)
    );
  }
  return tokens;
}

const bigintToHex = (amount: BigintIsh) => {
  return '0x' + amount.toString(16);
}

const getWethAddress = (chainID: number) => getAddress(
  chainID == 1
    ? '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    : '0x72710B0b93c8F86aEf4ec8bd832868A15df50375'
);

export default class Minter {
  public waitForUpdate: Promise<void>;
  public lastUpdateTime: number;
  public pairs: Pair[] = [];
  public userBalances: { [key: string]: BigNumber } = {};
  public userAllowances: { [key: string]: BigNumber } = {};

  protected constructor(
    public provider: Provider,
    public chainID: number,
    public inputTokens: Token[],
    public poolTokens: Token[],
    public helper: PoolHelper
  ) {
    let prom = Promise.all([
      this.setPairsInitial(),
      this.updateUserBalances()
    ]).then(() => {});
    this.waitForUpdate = prom;
  }

  get userAddress(): string {
    return this.helper.userAddress;
  }

  get timestamp(): number {
    return new Date().getTime() / 1000;
  }

  get shouldUpdate(): boolean {
    return this.timestamp - this.lastUpdateTime > 120; 
  }
  
  get wethAddress(): string {
    return getWethAddress(this.chainID);
  }

  get minterAddress(): string {
    return this.chainID == 1 ? '0x56cB0C7523a640249e1d10c892E5c03A3bC2C37F' : '0x9B46249Be2895422AcEeFd10005aC04452bdd51d';
  }

  async updateUserBalances() {
    if (!this.userAddress) return;
    const userData = await getTokenUserData(this.provider, this.userAddress, this.minterAddress, this.inputTokens);
    for (let i = 0; i < this.inputTokens.length; i++) {
      const address = this.inputTokens[i].address.toLowerCase();
      const { balance, allowance } = userData[i];
      this.userAllowances[address] = allowance;
      this.userBalances[address] = balance;
    }
  }

  getUserTokenData(token: string): { balance?: BigNumber, allowance?: BigNumber } {
    if (!this.userAddress || !this.userAllowances[token.toLowerCase()]) return {};
    return {
      balance: this.userBalances[token.toLowerCase()],
      allowance: this.userAllowances[token.toLowerCase()]
    };
  }

  getIndexedTokenAmount(address: string, tokenAmount: TokenAmount): IndexedJSTokenAmount {
    let { symbol, decimals } = tokenAmount.currency;
    let amount = bigintToHex(tokenAmount.raw);
    let displayAmount = formatBalance(toBN(amount), decimals, 4);
    let obj: IndexedJSTokenAmount = {
      address,
      symbol,
      decimals,
      amount,
      displayAmount
    };
    let tokenInfo = this.getUserTokenData(address);
    if (tokenInfo.allowance) {
      const { balance, allowance } = tokenInfo;
      obj.balance = toHex(balance);
      obj.allowance = toHex(allowance);
      if (allowance.lt(toBN(amount))) {
        obj.remainingApprovalAmount = toHex(toBN(amount).minus(allowance));
      }
    }
    return obj;
  }

  getTokenByAddress(address: string): Token {
    return [
      ...this.inputTokens,
      ...this.poolTokens
    ].find(t => t.address.toLowerCase() == address.toLowerCase());
  }

  getTokenAmount(address: string, amount: BigintIsh): TokenAmount {
    const token = this.getTokenByAddress(address);
    if (!token) throw Error(`Could not find token ${address}`)
    return new TokenAmount(token, amount);
  }

  getPoolTokenAmount(helper: PoolHelper, amountHex: string): TokenAmount {
    return new TokenAmount(
      new Token(this.chainID, getAddress(helper.address), 18, helper.pool.symbol, helper.pool.name),
      toBN(amountHex).toString(10)
    );
  }

  async setPairsInitial() {
    const pairs = [];
    for (let tokenA of this.inputTokens) {
      for (let tokenB of this.poolTokens) {
        if (tokenA.sortsBefore(tokenB)) {
          pairs.push(
            Fetcher.fetchPairData(tokenA, tokenB, this.provider as any).catch(() => {})
          );
        } else {
          pairs.push(
            Fetcher.fetchPairData(tokenB, tokenA, this.provider as any).catch(() => {})
          );
        }
      }
    }
    this.pairs = (await Promise.all(pairs)).filter(x => x);
    this.lastUpdateTime = this.timestamp;
  }

  async updatePairs() {
    const pairs = [];
    for (let i = 0; i < this.pairs.length; i++) {
      const pair = this.pairs[i];
      pairs.push(
        Fetcher.fetchPairData(pair.token0, pair.token1, this.provider as any).catch(() => {})
      );
    }
    this.pairs = await (await Promise.all(pairs));
    this.lastUpdateTime = this.timestamp;
  }

  update() {
    if (!this.pairs.length) {
      return this.waitForUpdate;
    }
    if (this.shouldUpdate) {
      let prom = Promise.all([
        this.updatePairs(),
        this.updateUserBalances()
      ]).then(() => {});
      this.waitForUpdate = prom;
    }
    return this.waitForUpdate;
  }

  protected async bestTradeExactIn(
    tokenIn: string,
    amountIn_: BigintIsh,
    tokenOut_: string,
    options?: BestTradeOptions
  ): Promise<Trade> {
    await this.update();
    const amountIn = this.getTokenAmount(tokenIn, amountIn_);
    const tokenOut = this.getTokenByAddress(tokenOut_);
    const trades = await Trade.bestTradeExactIn(
      this.pairs,
      amountIn,
      tokenOut,
      options
    );
    return trades[0];
  }

  protected async bestTradeExactOut(
    tokenIn_: string,
    tokenOut: string,
    amountOut_: BigintIsh,
    options?: BestTradeOptions
  ): Promise<Trade> {
    await this.update();
    const amountOut = this.getTokenAmount(tokenOut, amountOut_);
    const tokenIn = this.getTokenByAddress(tokenIn_);
    const trades = await Trade.bestTradeExactOut(
      this.pairs,
      tokenIn,
      amountOut,
      options
    );
    return trades[0];
  }

  protected async getCheapestSingleInput(poolAmountOut: string): Promise<IndexedJSTokenAmount & { cost: number }> {
    const helper = this.helper;
    const allTokens = helper.tokens;
    const proms: Promise<IndexedJSTokenAmount>[] = [];
    for (let token of allTokens) {
      proms.push(helper.calcSingleInGivenPoolOut(token.address, poolAmountOut));
    }
    const allSingleAmounts: IndexedJSTokenAmountWithCost[] = (await Promise.all(proms)).map((input) => ({
      ...input,
      cost: parseFloat(
        formatBalance(toBN(input.amount), input.decimals, 10)
      ) * helper.getTokenByAddress(input.address).priceUSD
    }));

    return allSingleAmounts.filter(
      (amount) => toBN(amount.amount).lt(
        helper.getTokenByAddress(amount.address).usedBalance.div(2)
      )
    ).sort((a, b) => a.cost - b.cost)[0];
  }

  protected async getMaximumOutputForSingleInput(
    tokenIn: string,
    tokenAmountIn: string,
    options?: MintOptions
  ): Promise<{ trade: Trade, poolAmount: IndexedJSTokenAmount }> {
    const slippage = new Fraction(((options && options.slippage) || 2).toString(), '100');
    const helper = this.helper;
    const proms: Promise<{ trade: Trade, poolAmount: IndexedJSTokenAmount }>[] = [];

    const getPoolOut = async (poolTokenIn: PoolToken) => {
      let bestTrade = await this.bestTradeExactIn(tokenIn, tokenAmountIn, poolTokenIn.address, options);
      let amount = toBN('0x' + bestTrade.minimumAmountOut(slippage).raw.toString(16));

      if (amount.gt(poolTokenIn.usedBalance.div(2))) {
        bestTrade = await this.bestTradeExactOut(tokenIn, poolTokenIn.address, toHex(poolTokenIn.usedBalance.div(2)), options);
        amount = toBN('0x' + bestTrade.minimumAmountOut(slippage).raw.toString(16))
      }
      const poolOut = await helper.calcPoolOutGivenSingleIn(poolTokenIn.address, amount);
      return {
        trade: bestTrade,
        poolAmount: poolOut
      }
    };
    const allTokens = helper.tokens;
    for (let token of allTokens) {
      proms.push(getPoolOut(token));
    }
    const allOutputs = await Promise.all(proms);
    return allOutputs.sort((a, b) => toBN(b.poolAmount.amount).minus(toBN(a.poolAmount.amount)).toNumber())[0]
  }

  protected async getBestParams_ExactTokenForTokens(
    tokenIn: string,
    tokenAmountIn: string,
    options?: MintOptions
  ): Promise<MintParams_ExactTokensForTokensAndMint> {
    const slippage = new Fraction(((options && options.slippage) || 2).toString(), '100');
    const maximumOutput = await this.getMaximumOutputForSingleInput(tokenIn, tokenAmountIn, options);
    const helper = this.helper;
    const poolOutput = this.getPoolTokenAmount(helper, maximumOutput.poolAmount.amount);

    const slippageAdjustedAmountOut = new Fraction(ONE)
      .add(slippage)
      .invert()
      .multiply(poolOutput.raw).quotient;
    
    const tokenInput = this.getIndexedTokenAmount(tokenIn, this.getTokenAmount(tokenIn, tokenAmountIn));
    const minPoolOutput = this.getIndexedTokenAmount(
      this.helper.address,
      this.getPoolTokenAmount(helper, '0x' + slippageAdjustedAmountOut.toString(16))
    )

    return {
      fn: 'swapExactTokensForTokensAndMint',
      tokenInput,
      minPoolOutput,
      path: maximumOutput.trade.route.path.map(t => t.address)
    };
  }

  protected async getBestParams_ExactEthForTokens(
    ethAmountIn: string,
    options?: MintOptions
  ): Promise<MintParams_ExactETHForTokensAndMint> {
    const slippage = new Fraction(((options && options.slippage) || 2).toString(), '100');
    const maximumOutput = await this.getMaximumOutputForSingleInput(this.wethAddress, ethAmountIn, options);
    const helper = this.helper;
    const poolOutput = this.getPoolTokenAmount(helper, maximumOutput.poolAmount.amount);
    const slippageAdjustedAmountOut = new Fraction(ONE)
      .add(slippage)
      .invert()
      .multiply(poolOutput.raw).quotient;

    const ethInput = this.getIndexedTokenAmount(
      this.wethAddress,
      this.getTokenAmount(this.wethAddress, ethAmountIn)
    );

    const minPoolOutput = this.getIndexedTokenAmount(
      this.helper.address,
      this.getPoolTokenAmount(helper, '0x' + slippageAdjustedAmountOut.toString(16))
    );

    return {
      fn: 'swapExactETHForTokensAndMint',
      ethInput,
      minPoolOutput,
      path: maximumOutput.trade.route.path.map(t => t.address)
    };
  }

  protected async getParams_EthForExactPoolTokens(
    poolAmountOut: string,
    options?: MintOptions
  ): Promise<MintParams_EthForTokensAndMintExact> {
    const tokenIn = this.wethAddress;
    const slippage = new Fraction(((options && options.slippage) || 2).toString(), '100');
    const cheapestInput = await this.getCheapestSingleInput(poolAmountOut);
    if (!cheapestInput) {
      return null;
    }
    const bestTrade = await this.bestTradeExactOut(tokenIn, cheapestInput.address, cheapestInput.amount, options);
    const helper = this.helper;

    const poolOutput = this.getIndexedTokenAmount(
      this.helper.address,
      this.getPoolTokenAmount(helper, poolAmountOut)
    );
    const maxEthInput = this.getIndexedTokenAmount(
      tokenIn,
      this.getTokenAmount(tokenIn, bestTrade.maximumAmountIn(slippage).raw)
    );
    return {
      fn: 'swapETHForTokensAndMintExact',
      poolOutput,
      maxEthInput,
      path: bestTrade.route.path.map(t => t.address)
    };
  }

  protected async getParams_TokensForExactPoolTokens(
    tokenIn: string,
    poolAmountOut: string,
    options?: MintOptions
  ): Promise<MintParams_TokensForTokensAndMintExact> {
    const slippage = new Fraction(((options && options.slippage) || 2).toString(), '100');
    const cheapestInput = await this.getCheapestSingleInput(poolAmountOut);
    if (!cheapestInput) return null;
    const bestTrade = await this.bestTradeExactOut(tokenIn, cheapestInput.address, cheapestInput.amount, options);
    const helper = this.helper;

    const poolOutput = this.getIndexedTokenAmount(
      this.helper.address,
      this.getPoolTokenAmount(helper, poolAmountOut)
    );
    const maxTokenInput = this.getIndexedTokenAmount(
      tokenIn,
      this.getTokenAmount(tokenIn, bestTrade.maximumAmountIn(slippage).raw)
    );
    return {
      fn: 'swapTokensForTokensAndMintExact',
      poolOutput,
      maxTokenInput,
      path: bestTrade.route.path.map(t => t.address)
    };
  }

  protected async getParams_TokenForAllTokens(
    tokenIn: string,
    poolAmountOut: string,
    options?: MintOptions
  ): Promise<MintParams_TokensForAllTokensAndMintExact> {
    const slippage = new Fraction(((options && options.slippage) || 2).toString(), '100');
    const helper = this.helper;
    const amountsIn = await helper.calcAllInGivenPoolOut(poolAmountOut);
    let amountInTotal = this.getTokenAmount(tokenIn, '0');
    for (let amount of amountsIn) {
      const bestTrade = await this.bestTradeExactOut(tokenIn, amount.address, amount.amount)
      amountInTotal = amountInTotal.add(bestTrade.maximumAmountIn(slippage) as TokenAmount);
    }

    const maxTokenInput = this.getIndexedTokenAmount(tokenIn, amountInTotal);
    const poolOutput = this.getIndexedTokenAmount(
      this.helper.address,
      this.getPoolTokenAmount(helper, poolAmountOut)
    );
    return {
      fn: 'swapTokensForAllTokensAndMintExact',
      maxTokenInput,
      poolOutput
    };
  }

  protected async getParams_EthForAllTokens(
    poolAmountOut: string,
    options?: MintOptions
  ): Promise<{
    params: MintParams_EthForAllTokensAndMintExact,
    trades: Trade[]
  }> {
    const slippage = new Fraction(((options && options.slippage) || 2).toString(), '100');
    const helper = this.helper;
    const amountsIn = await helper.calcAllInGivenPoolOut(poolAmountOut);
    let amountInTotal = this.getTokenAmount(this.wethAddress, '0');
    const trades: Trade[] = [];
    const proms: Promise<void>[] = [];
    for (let amount of amountsIn) {
      proms.push(
        this.bestTradeExactOut(
          this.wethAddress,
          amount.address,
          amount.amount
        ).then((bestTrade) => {
          amountInTotal = amountInTotal.add(bestTrade.maximumAmountIn(slippage) as TokenAmount);
          trades.push(bestTrade)
        })
      );
    }
    await Promise.all(proms);

    const maxEthInput = this.getIndexedTokenAmount(this.wethAddress, amountInTotal);
    const poolOutput = this.getIndexedTokenAmount(
      this.helper.address,
      this.getPoolTokenAmount(helper, poolAmountOut)
    );

    return {
      params: {
        fn: 'swapETHForAllTokensAndMintExact',
        maxEthInput,
        poolOutput
      },
      trades
    };
  }

  public async getBestParams_EthForPoolExact(
    poolAmountOut: string,
    options?: MintOptions
  ): Promise<MintParams_EthForAllTokensAndMintExact | MintParams_EthForTokensAndMintExact> {
    const all = await this.getParams_EthForAllTokens(poolAmountOut, options);
    const single = await this.getParams_EthForExactPoolTokens(poolAmountOut, options);

    if (
      !single ||
      toBN(single.maxEthInput.amount).gt(
        toBN(all.params.maxEthInput.amount)
      )
    ) {
      return all.params;
    } else {
      return single;
    }
  }

  public async getBestParams_TokensForPoolExact(
    tokenIn: string,
    poolAmountOut: string,
    options?: MintOptions
  ): Promise<MintParams_TokensForAllTokensAndMintExact | MintParams_TokensForTokensAndMintExact> {
    const all = await this.getParams_TokenForAllTokens(tokenIn, poolAmountOut, options);
    const single = await this.getParams_TokensForExactPoolTokens(tokenIn, poolAmountOut, options);
    if (
      !single ||
      toBN(single.maxTokenInput.amount).gt(
        toBN(all.maxTokenInput.amount)
      )
    ) {
      return all;
    } else {
      return single;
    }
  }

  public async getBestParams_ExactTokensForPool(
    tokenIn: string,
    tokenAmountIn: string,
    options?: MintOptions
  ): Promise<MintParams_TokensForAllTokensAndMintExact | MintParams_ExactTokensForTokensAndMint> {
    const bestSingle = await this.getBestParams_ExactTokenForTokens(
      tokenIn,
      tokenAmountIn,
      options
    );
    const bestMulti = await this.getParams_TokenForAllTokens(
      tokenIn,
      bestSingle.minPoolOutput.amount,
      options
    );
    if (
      toBN(bestSingle.tokenInput.amount).lt(
        toBN(bestMulti.maxTokenInput.amount)
      )
    ) {
      return bestSingle;
    } else {
      return bestMulti;
    }
  }

  public async getBestParams_ExactEthForPool(
    ethAmountIn: string,
    options?: MintOptions
  ): Promise<MintParams_EthForAllTokensAndMintExact | MintParams_ExactETHForTokensAndMint> {
    const bestSingle = await this.getBestParams_ExactEthForTokens(
      ethAmountIn,
      options
    );
    const bestMulti = await this.getParams_EthForAllTokens(
      bestSingle.minPoolOutput.amount,
      options
    );
    if (
      toBN(bestSingle.ethInput.amount).lt(
        toBN(bestMulti.params.maxEthInput.amount)
      )
    ) {
      return bestSingle;
    } else {
      return bestMulti.params;
    }
  }

  static async getMinter(
    provider_: any,
    chainID: number,
    tokenInputs: TokenInput[],
    helper: PoolHelper
  ): Promise<Minter> {
    const provider = toProvider(provider_);
    let weth = getWethAddress(chainID);
    if (
      !(tokenInputs.find(
        t => t.address.toLowerCase() == weth.toLowerCase()
      ))
    ) {
      tokenInputs.push({ name: 'Wrapped Ether', symbol: 'WETH', decimals: 18, address: weth });
    }
    let poolHasToken = (address: string) => !!(helper.tokens.find(t => t.address.toLowerCase() == address.toLowerCase()));
    return new Minter(
      provider,
      chainID,
      toTokens(chainID, tokenInputs.filter(t => !poolHasToken(t.address))),
      toTokens(chainID, helper.tokens),
      helper
    );
  }
}