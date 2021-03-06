import { Fetcher, Trade, TokenAmount, Token, Pair, BigintIsh, BestTradeOptions, Fraction, JSBI, Route } from '@uniswap/sdk';
import { Provider } from '@ethersproject/providers';
import { getAddress } from 'ethers/lib/utils';
import { PoolHelper, TokenAmount as IndexedJSTokenAmount  } from '../pool-helper';
import { toBN, formatBalance, toHex, BigNumber } from '../utils/bignumber';
import { toProvider } from '../utils/provider';
import { PoolToken } from '../types';
import { getWethAddress, zeroAddress } from '../constants';
import { TokenInput, toTokens, bigintToHex, getPair } from '../utils/uniswap';

const ONE = JSBI.BigInt(1);

import {
  MintParams_TokensForAllTokensAndMintExact,
  MintParams_EthForAllTokensAndMintExact,
  MintParams_TokensForTokensAndMintExact,
  MintParams_ExactTokensForTokensAndMint,
  MintParams_EthForTokensAndMintExact,
  MintParams_ExactETHForTokensAndMint
} from './types';

import { getTokenUserData } from '../multicall';
import { getGasPrice } from '../utils/gas-price';

export type MintOptions = BestTradeOptions & {
  slippage?: number,
  compareGasPrice?: boolean
};

export type IndexedJSTokenAmountWithCost = IndexedJSTokenAmount & { cost: number };

export default class Minter {
  public waitForUpdate: Promise<void>;
  public lastUpdateTime: number;
  public pairs: Pair[] = [];
  public userBalances: { [key: string]: BigNumber } = {};
  public userAllowances: { [key: string]: BigNumber } = {};
  public lastGasPrice?: number;
  public lastGasPriceUpdate?: number;

  protected constructor(
    public provider: Provider,
    public network: 'mainnet' | 'rinkeby',
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
    return getWethAddress(this.network);
  }

  get minterAddress(): string {
    return this.network === 'mainnet' ? '0xfb6Ac20d38A1F0C4f90747CA0745E140bc17E4C3' : '0x5A8a169a86A63741A769de61E258848746A84094';
  }

  async getGasPrice(): Promise<number> {
    if (this.timestamp - (this.lastGasPriceUpdate || 0) >= 60) {
      this.lastGasPriceUpdate = this.timestamp;
      let curProm = this.waitForUpdate;
      let newProm = getGasPrice(this.network).then((price) => this.lastGasPrice = price);
      this.waitForUpdate = Promise.all([ curProm, newProm ]).then(() => {})
    }
    await this.waitForUpdate;
    return this.lastGasPrice
  }

  async canMintSingle_PoolAmountOut(poolToken: string, poolAmountOut: BigNumber): Promise<{
    canMint: boolean,
    amountIn?: IndexedJSTokenAmount
  }> {
    const poolRatio = poolAmountOut.div(this.helper.pool.totalSupply);
    const extrapolatedValue = this.helper.extrapolateValue(poolToken);
    const roughEstimate = extrapolatedValue.times(poolRatio);
    const maxAmountIn = this.helper.getTokenByAddress(poolToken).usedBalance.div(2);
    if (roughEstimate.gt(maxAmountIn)) return { canMint: false };
    const amountIn = await this.helper.calcSingleInGivenPoolOut(poolToken, poolAmountOut);
    if (toBN(amountIn.amount).gt(maxAmountIn)) return { canMint: false };
    return { canMint: true, amountIn };
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
    this.userAllowances[zeroAddress] = new BigNumber(0);
    this.userBalances[zeroAddress] = await this.provider.getBalance(this.userAddress).then(toBN);
  }

  getUserTokenData(token: string): { balance?: BigNumber, allowance?: BigNumber } {
    if (!this.userAddress || !this.userAllowances[token.toLowerCase()]) return {};
    return {
      balance: this.userBalances[token.toLowerCase()],
      allowance: this.userAllowances[token.toLowerCase()]
    };
  }

  getIndexedTokenAmount(address: string, tokenAmount: TokenAmount): IndexedJSTokenAmount {
    let symbol: string, decimals: number;
    if (address == zeroAddress) {
      symbol = 'ETH';
      decimals = 18;
    } else {
      ({ symbol, decimals } = tokenAmount.currency);
    }
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

  getSinglePair(tokenA: string, tokenB: string): Pair {
    let a = getAddress(tokenA);
    let b = getAddress(tokenB);
    return this.pairs.find(
      p => (
        (a == p.token0.address && b == p.token1.address) ||
        (b == p.token0.address && a == p.token1.address)
      )
    );
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
      new Token(this.network === 'mainnet' ? 1 : 4, getAddress(helper.address), 18, helper.pool.symbol, helper.pool.name),
      toBN(amountHex).toString(10)
    );
  }

  async setPairsInitial() {
    const pairs = [];
    for (let i = 0; i < this.inputTokens.length; i++) {
      let tokenA = this.inputTokens[i];
      for (let j = i + 1; j < this.inputTokens.length; j++) {
        pairs.push(getPair(this.provider, tokenA, this.inputTokens[j]));
      }
      for (let tokenB of this.poolTokens) {
        pairs.push(getPair(this.provider, tokenA, tokenB));
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
    const proms: Promise<{ canMint: boolean; amountIn?: IndexedJSTokenAmount}>[] = [];
    for (let token of allTokens) {
      proms.push(this.canMintSingle_PoolAmountOut(token.address, toBN(poolAmountOut)));
    }
    const res = (await Promise.all(proms)).filter(r => r.canMint).map(r => r.amountIn);
    const allSingleAmounts: IndexedJSTokenAmountWithCost[] = res.map((input) => ({
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
      zeroAddress,
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
      zeroAddress,
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

  protected getMaxCostSingleInput(
    tokenIn: string,
    tokenOut: string,
    amountOut: string,
    slippage: Fraction
  ): TokenAmount {
    const pair = this.getSinglePair(tokenIn, tokenOut);
    const trade = Trade.exactOut(
      new Route([pair], this.getTokenByAddress(tokenIn), this.getTokenByAddress(tokenOut)),
      this.getTokenAmount(tokenIn, amountOut)
    );
    return this.getTokenAmount(tokenIn, trade.maximumAmountIn(slippage).raw);
  }

  public async getParams_TokenForAllTokens(
    tokenIn: string,
    poolAmountOut: string,
    options?: MintOptions
  ): Promise<MintParams_TokensForAllTokensAndMintExact> {
    const slippage = new Fraction(((options && options.slippage) || 2).toString(), '100');
    const helper = this.helper;
    const amountsIn = await helper.calcAllInGivenPoolOut(poolAmountOut);
    let amountInTotal = this.getTokenAmount(tokenIn, '0');

    const intermediaries: string[] = await Promise.all(
      amountsIn.map(async (amount, i) => {
        const bestTrade = await this.bestTradeExactOut(tokenIn, amount.address, amount.amount, { maxHops: 2 });
        amountInTotal = amountInTotal.add(bestTrade.maximumAmountIn(slippage) as TokenAmount);
        if (bestTrade.route.path.length != 2) {
          return bestTrade.route.path[1].address;
        }
        return zeroAddress;
      })
    );

    const maxTokenInput = this.getIndexedTokenAmount(tokenIn, amountInTotal);
    const poolOutput = this.getIndexedTokenAmount(
      this.helper.address,
      this.getPoolTokenAmount(helper, poolAmountOut)
    );

    return {
      fn: 'swapTokensForAllTokensAndMintExact',
      maxTokenInput,
      poolOutput,
      intermediaries
    };
  }

  public async getParams_EthForAllTokens(
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


    const intermediaries: string[] = await Promise.all(
      amountsIn.map(async (amount) => {
        const bestTrade = await this.bestTradeExactOut(this.wethAddress, amount.address, amount.amount, { maxHops: 2 });
        amountInTotal = amountInTotal.add(bestTrade.maximumAmountIn(slippage) as TokenAmount);
        if (bestTrade.route.path.length != 2) {
          return bestTrade.route.path[1].address;
        }
        return zeroAddress;
      })
    );

    const maxEthInput = this.getIndexedTokenAmount(zeroAddress, amountInTotal);
    const poolOutput = this.getIndexedTokenAmount(
      this.helper.address,
      this.getPoolTokenAmount(helper, poolAmountOut)
    );

    return {
      params: {
        fn: 'swapETHForAllTokensAndMintExact',
        maxEthInput,
        poolOutput,
        intermediaries
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
    if (single) {
      let ethSingle = toBN(single.maxEthInput.amount);
      let ethAll = toBN(all.params.maxEthInput.amount);
      if (ethSingle.lt(ethAll)) {
        return single;
      }
      if (options?.compareGasPrice) {
        const gasPrice = await this.getGasPrice();
        const roughSingleGas = 300000;
        const roughAllGas = this.poolTokens.length * 220000;
        const roughCostAll = (roughAllGas - roughSingleGas) * gasPrice;
        ethAll = ethAll.plus(roughCostAll);
        if (ethSingle.lt(ethAll)) return single;
      }
    }
    return all.params;
  }

  public async getBestParams_TokensForPoolExact(
    tokenIn: string,
    poolAmountOut: string,
    options?: MintOptions
  ): Promise<MintParams_TokensForAllTokensAndMintExact | MintParams_TokensForTokensAndMintExact> {
    const all = await this.getParams_TokenForAllTokens(tokenIn, poolAmountOut, options && { slippage: options.slippage });
    const single = await this.getParams_TokensForExactPoolTokens(tokenIn, poolAmountOut, options);
    if (single) {
      let tokenSingle = toBN(single.maxTokenInput.amount);
      let tokenAll = toBN(all.maxTokenInput.amount);
      if (tokenSingle.lt(tokenAll)) {
        return single;
      }
      if (options?.compareGasPrice) {
        const gasPrice = await this.getGasPrice();
        const roughSingleGas = 300000;
        const roughAllGas = this.poolTokens.length * 220000;
        const roughCostAll = (roughAllGas - roughSingleGas) * gasPrice;
        const tokenValue = await this.bestTradeExactIn(this.wethAddress, roughCostAll.toString(), tokenIn);
        const bnValue = toBN(bigintToHex(tokenValue.outputAmount.raw));
        tokenAll = tokenAll.plus(bnValue);
        if (tokenSingle.lt(tokenAll)) return single;
      }
    }
    return all;
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
      options && { slippage: options.slippage }
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
    const network = chainID === 1 ? 'mainnet' : 'rinkeby'
    const provider = toProvider(provider_);
    let weth = getWethAddress(network);
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
      network,
      toTokens(chainID, tokenInputs.filter(t => !poolHasToken(t.address))),
      toTokens(chainID, helper.tokens),
      helper
    );
  }
}