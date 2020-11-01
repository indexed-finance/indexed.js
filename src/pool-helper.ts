import { Provider, Web3Provider } from "@ethersproject/providers";
import { bnum, calcAllInGivenPoolOut, calcAllOutGivenPoolIn, calcSingleInGivenPoolOut, calcSingleOutGivenPoolIn } from "./bmath";
import { getCurrentPoolData } from "./multicall";
import { InitializedPool, PoolToken } from "./types";
import { BigNumber, BigNumberish, formatBalance } from './utils/bignumber';

export type TokenAmount = {
  symbol: string;
  decimals: number;
  amount: BigNumber;
  displayAmount: string;
}

export class PoolHelper {
  lastUpdate: number;
  waitForUpdate: Promise<void>;
  private provider: Provider;

  constructor(
    provider: any,
    public pool: InitializedPool
  ) {
    if (Object.keys(provider).includes('currentProvider')) {
      this.provider = new Web3Provider(provider.currentProvider);
    } else {
      this.provider = provider;
    }
    this.lastUpdate = 0;
    this.waitForUpdate = this.update();
  }

  get tokens(): PoolToken[] {
    return this.pool.tokens;
  }

  get shouldUpdate(): boolean {
    const timestamp = Math.floor(+new Date() / 1000);
    return timestamp - this.lastUpdate > 600;
  }

  async update(): Promise<void> {
    const {
      totalWeight, totalSupply, maxTotalSupply, swapFee, tokens
    } = await getCurrentPoolData(this.provider, this.pool.address, this.tokens);
    this.pool.totalSupply = totalSupply;
    this.pool.totalWeight = totalWeight;
    this.pool.maxTotalSupply = maxTotalSupply;
    this.pool.swapFee = swapFee;
    for (let i = 0; i < tokens.length; i++) {
      const token = this.pool.tokens[i];
      token.balance = tokens[i].balance;
      token.usedBalance = tokens[i].usedBalance;
      token.usedDenorm = tokens[i].usedDenorm;
      token.usedWeight = tokens[i].usedWeight;
    }
    this.lastUpdate = Math.floor(+new Date() / 1000);
  }

  getTokenBySymbol(symbol: string): PoolToken {
    for (let token of this.tokens) {
      if (token.symbol.toLowerCase() == symbol.toLowerCase()) {
        return token;
      }
    }
    throw new Error(`Token with symbol ${symbol} not found in pool.`);
  }

  async getJoinRateSingle(tokenSymbol: string, poolTokensToMint: BigNumberish): Promise<TokenAmount> {
    if (this.shouldUpdate) await this.update();
    const token = this.getTokenBySymbol(tokenSymbol);
    const amountIn = calcSingleInGivenPoolOut(
      token.usedBalance,
      token.usedDenorm,
      this.pool.totalSupply,
      this.pool.totalWeight,
      bnum(poolTokensToMint),
      this.pool.swapFee
    );
    return {
      symbol: token.symbol,
      amount: amountIn,
      decimals: token.decimals,
      displayAmount: formatBalance(amountIn, token.decimals, 4)
    };
  }

  async getJoinRateMulti(poolTokensToMint: BigNumberish): Promise<TokenAmount[]> {
    if (this.shouldUpdate) await this.update();
    const symbols: string[] = [];
    const decimals: number[] = [];
    const usedBalances: BigNumber[] = [];
    for (let token of this.tokens) {
      symbols.push(token.symbol);
      decimals.push(token.decimals);
      usedBalances.push(token.usedBalance);
    }
    const poolAmountOut = bnum(poolTokensToMint);
    const amounts = calcAllInGivenPoolOut(usedBalances, this.pool.totalSupply, poolAmountOut);
    return amounts.reduce((arr, amount, i) => [
      ...arr,
      {
        amount,
        symbol: symbols[i],
        decimals: decimals[i],
        displayAmount: formatBalance(amount, decimals[i], 4)
      }
    ], []);
  }

  async getLeaveRateSingle(tokenSymbol: string, poolTokensToBurn: BigNumberish): Promise<TokenAmount> {
    if (this.shouldUpdate) await this.update();
    const token = this.getTokenBySymbol(tokenSymbol);
    if (!token.ready) {
      throw Error(`Can not exit into token which is not initialized.`);
    }
    const amountOut = calcSingleOutGivenPoolIn(
      token.balance,
      token.denorm,
      this.pool.totalSupply,
      this.pool.totalWeight,
      bnum(poolTokensToBurn),
      this.pool.swapFee
    );
    return {
      amount: amountOut,
      symbol: tokenSymbol,
      displayAmount: formatBalance(amountOut, token.decimals, 4),
      decimals: token.decimals
    };
  }

  async getLeaveRateMulti(poolTokensToBurn: BigNumberish): Promise<TokenAmount[]> {
    if (this.shouldUpdate) await this.update();
    const symbols: string[] = [];
    const decimals: number[] = [];
    const balances: BigNumber[] = [];
    const denorms: BigNumber[] = [];
    for (let token of this.tokens) {
      symbols.push(token.symbol);
      decimals.push(token.decimals);
      balances.push(token.balance);
      denorms.push(token.denorm);
    }
    const poolAmountOut = bnum(poolTokensToBurn);
    const amounts = calcAllOutGivenPoolIn(balances, denorms, this.pool.totalSupply, poolAmountOut);
    return amounts.reduce((arr, amount, i) => [
      ...arr,
      {
        amount,
        symbol: symbols[i],
        decimals: decimals[i],
        displayAmount: formatBalance(amount, decimals[i], 4)
      }
    ], []);
  }
}