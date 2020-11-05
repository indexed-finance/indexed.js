import { Provider, Web3Provider } from "@ethersproject/providers";
import { bnum, calcAllInGivenPoolOut, calcAllOutGivenPoolIn, calcSingleInGivenPoolOut, calcSingleOutGivenPoolIn } from "./bmath";
import { getAllowances, getCurrentPoolData } from "./multicall";
import { InitializedPool, PoolToken } from "./types";
import { BigNumber, BigNumberish, formatBalance, toHex } from './utils/bignumber';

export type TokenAmount = {
  address: string;
  symbol: string;
  decimals: number;
  amount: string;
  displayAmount: string;
  remainingApprovalAmount?: string;
  remainingApprovalDisplayAmount?: string;
}

export class PoolHelper {
  lastUpdate: number;
  waitForUpdate: Promise<void>;
  private provider: Provider;
  private allowances?: { [key: string]: BigNumber };

  constructor(
    provider: any,
    public pool: InitializedPool,
    public userAddress?: string
  ) {
    if (Object.keys(provider).includes('currentProvider')) {
      this.provider = new Web3Provider(provider.currentProvider);
    } else {
      this.provider = provider;
    }
    this.lastUpdate = 0;
    if (this.userAddress) {
      this.allowances = {};
    }
    this.waitForUpdate = this.update();
  }

  get tokens(): PoolToken[] {
    return this.pool.tokens;
  }

  get shouldUpdate(): boolean {
    const timestamp = Math.floor(+new Date() / 1000);
    return timestamp - this.lastUpdate > 600;
  }

  getRemainingApprovalAmount(address: string, amount: BigNumber): {
    remainingApprovalAmount?: string,
    remainingApprovalDisplayAmount?: string
  } {
    if (!this.userAddress) return {};
    const { decimals } = this.getTokenByAddress(address);
    const allowance = this.allowances[address];
    if (allowance.gte(amount)) return {
      remainingApprovalAmount: '0x0',
      remainingApprovalDisplayAmount: ''
    };
    const remainingApprovalAmount = amount.minus(allowance)
    return {
      remainingApprovalAmount: toHex(remainingApprovalAmount),
      remainingApprovalDisplayAmount: formatBalance(remainingApprovalAmount, decimals, 4)
    };
  }

  async updatePool(): Promise<void> {
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
  }

  async updateAllowances(): Promise<void> {
    if (!this.userAddress) return;
    const tokens = this.tokens;
    const allowances = await getAllowances(this.provider, this.userAddress, this.pool.address, tokens);
    allowances.forEach((allowance, i) => {
      const address = tokens[i].address;
      this.allowances[address] = allowance;
    });
  }

  async update(): Promise<void> {
    this.lastUpdate = Math.floor(+new Date() / 1000);
    await Promise.all([ this.updatePool(), this.updateAllowances() ]);
  }

  getTokenBySymbol(symbol: string): PoolToken {
    for (let token of this.tokens) {
      if (token.symbol.toLowerCase() == symbol.toLowerCase()) {
        return token;
      }
    }
    throw new Error(`Token with symbol ${symbol} not found in pool.`);
  }

  getTokenByAddress(address: string): PoolToken {
    for (let token of this.tokens) {
      if (token.address.toLowerCase() == address.toLowerCase()) {
        return token;
      }
    }
    throw new Error(`Token with address ${address} not found in pool.`);
  }

  async getJoinRateSingle(address: string, poolTokensToMint: BigNumberish): Promise<TokenAmount> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const token = this.getTokenByAddress(address);
    const amountIn = calcSingleInGivenPoolOut(
      token.usedBalance,
      token.usedDenorm,
      this.pool.totalSupply,
      this.pool.totalWeight,
      bnum(poolTokensToMint),
      this.pool.swapFee
    );
    return {
      address,
      symbol: token.symbol,
      amount: toHex(amountIn),
      decimals: token.decimals,
      displayAmount: formatBalance(amountIn, token.decimals, 4),
      ...this.getRemainingApprovalAmount(address, amountIn)
    };
  }

  async getJoinRateMulti(poolTokensToMint: BigNumberish): Promise<TokenAmount[]> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const usedBalances: BigNumber[] = [];
    const partials: { address: string, symbol: string, decimals: number }[] = [];
    for (let token of this.tokens) {
      const { symbol, address, decimals, usedBalance } = token;
      partials.push(Object.assign({}, { symbol, address, decimals }));
      usedBalances.push(new BigNumber(usedBalance))
    }
    const poolAmountOut = bnum(poolTokensToMint);
    const amounts = calcAllInGivenPoolOut(usedBalances, this.pool.totalSupply, poolAmountOut);
    return amounts.reduce((arr, amount, i) => [
      ...arr,
      {
        ...partials[i],
        amount,
        displayAmount: formatBalance(amount, partials[i].decimals, 4),
        ...this.getRemainingApprovalAmount(partials[i].address, amount)
      }
    ], []);
  }

  async getLeaveRateSingle(address: string, poolTokensToBurn: BigNumberish): Promise<TokenAmount> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const token = this.getTokenByAddress(address);
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
      address,
      amount: toHex(amountOut),
      symbol: token.symbol,
      displayAmount: formatBalance(amountOut, token.decimals, 4),
      decimals: token.decimals
    };
  }

  async getLeaveRateMulti(poolTokensToBurn: BigNumberish): Promise<TokenAmount[]> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const balances: BigNumber[] = [];
    const denorms: BigNumber[] = [];
    const partials: { address: string, symbol: string, decimals: number }[] = [];
    for (let token of this.tokens) {
      const { symbol, address, decimals, balance, denorm } = token;
      partials.push(Object.assign({}, { symbol, address, decimals }));
      balances.push(new BigNumber(balance));
      denorms.push(new BigNumber(denorm));
    }
    const poolAmountOut = bnum(poolTokensToBurn);
    const amounts = calcAllOutGivenPoolIn(balances, denorms, this.pool.totalSupply, poolAmountOut);
    return amounts.reduce((arr, amount, i) => [
      ...arr,
      {
        ...partials[i],
        amount: toHex(amount),
        displayAmount: formatBalance(amount, partials[i].decimals, 4)
      }
    ], []);
  }
}