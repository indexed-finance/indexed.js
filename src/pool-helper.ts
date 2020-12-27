import { Provider } from "@ethersproject/providers";
import { Pair, Token as UniswapToken, TokenAmount as UniswapTokenAmount } from "@uniswap/sdk";
import { Contract } from "ethers";
import { getAddress } from "ethers/lib/utils";

import { getPoolSnapshots, INDEXED_RINKEBY_SUBGRAPH_URL, INDEXED_SUBGRAPH_URL } from "./subgraph";
import { toProvider } from "./utils/provider";
import {
  bnum,
  calcAllInGivenPoolOut,
  calcAllOutGivenPoolIn,
  calcInGivenOut,
  calcOutGivenIn,
  calcPoolInGivenSingleOut,
  calcPoolOutGivenSingleIn,
  calcSingleInGivenPoolOut,
  calcSingleOutGivenPoolIn,
  calcSpotPrice
} from "./bmath";
import { getTokenUserData, getCurrentPoolData } from "./multicall";
import { InitializedPool, PoolDailySnapshot, PoolToken, Token } from "./types";
import { BigNumber, BigNumberish, formatBalance, toBN, toHex } from './utils/bignumber';
import { bigintToHex, getPair, getUniswapWethType } from "./utils/uniswap";

const IERC20ABI = require('./abi/IERC20.json');

export type TokenAmount = {
  address: string;
  symbol: string;
  decimals: number;
  amount: string;
  displayAmount: string;
  remainingApprovalAmount?: string;
  // user balance
  balance?: string;
  // allowance for pool
  allowance?: string;
}

export class PoolHelper {
  lastUpdate: number;
  waitForUpdate: Promise<void>;

  public provider: Provider;
  public userAllowances: { [key: string]: BigNumber } = {};
  public userBalances: { [key: string]: BigNumber } = {};
  public userPoolBalance?: BigNumber;

  lastUpdateUniswap: number;
  waitForUniswapUpdate: Promise<void>;
  public ethUniswapPair?: Pair;
  public allowanceUniswapPair?: BigNumber;
  public ethBalance?: BigNumber;

  constructor(
    provider: any,
    public chainID: number,
    public pool: InitializedPool,
    public userAddress?: string
  ) {
    this.provider = toProvider(provider);
    this.lastUpdate = new Date().getTime();
    this.waitForUpdate = this.update();
    this.lastUpdateUniswap = new Date().getTime();
    this.waitForUniswapUpdate = this.updateUniswap();
  }

  async updateUniswap() {
    this.lastUpdateUniswap = new Date().getTime();
    let weth = getUniswapWethType(this.chainID);
    let pool = this.uniswapPoolTokenType;
    const pair = await getPair(this.provider, weth, pool);
    if (pair) {
      this.ethUniswapPair = pair;
      if (this.userAddress) {
        await Promise.all([
          this.provider.getBalance(this.userAddress).then(b => this.ethBalance = toBN(b)),
          new Contract(this.pool.address, IERC20ABI, this.provider).allowance(
            this.userAddress,
            pair.liquidityToken.address
          ).then(a => this.allowanceUniswapPair = toBN(a))
        ]);
      }
    }
  }

  async getUniswapOut(
    tokenIn: string,
    amountIn: BigNumberish,
    slippage: number = 2
  ): Promise<{
    approvalNeeded: boolean,
    amountOut: string,
    displayAmountOut: string,
    price: number
  }> {
    await this.waitForUniswapUpdate;
    const pair = this.ethUniswapPair;
    if (!pair) return null;
    const isPoolToken = tokenIn.toLowerCase() == this.address.toLowerCase();
    const input = isPoolToken ? this.uniswapPoolTokenType : getUniswapWethType(this.chainID);
    const amt = new UniswapTokenAmount(input, toBN(amountIn).toString(10));
    const amountOut = pair.getOutputAmount(amt);
    const bnAmount = toBN(bigintToHex(amountOut[0].raw));
    const bnAmountMin = bnAmount.times(100 - slippage).div(100);
    let approvalNeeded = false;
    if (this.userAddress) {
      if (isPoolToken && this.allowanceUniswapPair.lt(toBN(amountIn))) {
        approvalNeeded = true;
      }
    }
    const displayAmountOut = formatBalance(bnAmountMin, 18, 4);
    const displayAmountIn = formatBalance(toBN(amountIn), 18, 4);
    const price = parseFloat(displayAmountOut) / parseFloat(displayAmountIn);
    return {
      approvalNeeded,
      amountOut: toHex(bnAmountMin),
      displayAmountOut,
      price
    }
  }

  async getUniswapIn(
    tokenOut: string,
    amountOut: BigNumberish,
    slippage: number = 2
  ): Promise<{
    approvalNeeded: boolean,
    amountIn: string,
    displayAmountIn: string,
    price: number
  }> {
    await this.waitForUniswapUpdate;
    const pair = this.ethUniswapPair;
    if (!pair) return null;
    const isPoolToken = tokenOut.toLowerCase() == this.address.toLowerCase();
    const output = isPoolToken ? this.uniswapPoolTokenType : getUniswapWethType(this.chainID);
    const amt = new UniswapTokenAmount(output, toBN(amountOut).toString(10));
    const amountIn = pair.getInputAmount(amt);
    const bnAmount = toBN(bigintToHex(amountIn[0].raw));
    const maxBnAmount = bnAmount.times(100 + slippage).div(100);
    let approvalNeeded = false;
    if (this.userAddress) {
      if (!isPoolToken && this.allowanceUniswapPair.lt(maxBnAmount)) {
        approvalNeeded = true;
      }
    }
    const displayAmountOut = formatBalance(toBN(amountOut), 18, 4);
    const displayAmountIn = formatBalance(maxBnAmount, 18, 4);
    const price = parseFloat(displayAmountOut) / parseFloat(displayAmountIn);
    return {
      approvalNeeded,
      amountIn: toHex(maxBnAmount),
      displayAmountIn,
      price
    }
  }

  get uniswapPoolTokenType(): UniswapToken {
    return new UniswapToken(
      this.chainID,
      getAddress(this.address),
      18,
      this.symbol,
      this.name
    );
  }

  get initializer(): string {
    return this.pool.initializer;
  }

  get category(): number {
    return this.pool.category;
  }

  get name(): string {
    return this.pool.name;
  }

  get symbol(): string {
    return this.pool.symbol;
  }

  get address(): string {
    return this.pool.address;
  }

  get tokens(): PoolToken[] {
    return this.pool.tokens;
  }

  get shouldUpdate(): boolean {
    const timestamp = Math.floor(+new Date() / 1000);
    return timestamp - this.lastUpdate > 600;
  }

  extrapolateValue(token: string): BigNumber {
    const { usedBalance, usedDenorm } = this.getTokenByAddress(token);
    const { totalWeight } = this.pool;
    return usedBalance.times(totalWeight).div(usedDenorm);
  }

  get totalValueLocked(): number {
    let tvl = 0;
    for (let token of this.tokens) {
      const balance = parseFloat(formatBalance(token.balance, 18, 10));
      const value = balance * token.priceUSD;
      tvl += value;
    }
    return tvl;
  }

  async getSnapshots(days: number): Promise<PoolDailySnapshot[]> {
    let url = (this.chainID == 1) ? INDEXED_SUBGRAPH_URL : INDEXED_RINKEBY_SUBGRAPH_URL;
    return getPoolSnapshots(url, this.address, days);
  }

  getUserTokenData(address: string, amount: BigNumber): {
    remainingApprovalAmount?: string,
    allowance?: string,
    balance?: string
  } {
    if (!this.userAddress) return {};
    const allowance = this.userAllowances[address];
    if (allowance.gte(amount)) return {
      remainingApprovalAmount: '0x0',
      allowance: '0x0',
      balance: '0x0'
    };
    const remainingApprovalAmount = amount.minus(allowance)
    return {
      remainingApprovalAmount: toHex(remainingApprovalAmount),
      allowance: toHex(allowance),
      balance: toHex(this.userBalances[address])
    };
  }

  setUserAddress(userAddress: string) {
    this.userAddress = userAddress;
    this.waitForUpdate = this.update();
    this.waitForUniswapUpdate = this.updateUniswap();
  }

  async updatePool(): Promise<void> {
    const {
      userBalance,
      totalWeight,
      totalSupply,
      maxTotalSupply,
      swapFee,
      tokens
    } = await getCurrentPoolData(this.provider, this.pool.address, this.tokens, this.userAddress);
    this.userPoolBalance = userBalance;
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

  async updateUserData(): Promise<void> {
    if (!this.userAddress) return;
    const tokens = this.tokens;
    const tokenDatas = await getTokenUserData(this.provider, this.userAddress, this.pool.address, tokens);
    tokenDatas.forEach(({ allowance, balance }, i) => {
      const address = tokens[i].address;
      this.userAllowances[address] = allowance;
      this.userBalances[address] = balance;
    });
  }

  async update(): Promise<void> {
    this.lastUpdate = Math.floor(+new Date() / 1000);
    await Promise.all([ this.updatePool(), this.updateUserData() ]);
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

  /**
   * Calculate the amount of a specific token that must be provided to mint a given amount of pool tokens.
   * 
   * @param address Address of the token to provide
   * @param poolTokensToMint Amount of pool tokens to mint
   */
  async calcSingleInGivenPoolOut(address: string, poolTokensToMint: BigNumberish): Promise<TokenAmount> {
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
      ...this.getUserTokenData(address, amountIn)
    };
  }

  /**
   * Calculate the amount of pool tokens that can be minted by providing a given amount of a specific token.
   *
   * @param address Address of the token to provide
   * @param tokenAmountIn Amount of tokens to provide
   */
  async calcPoolOutGivenSingleIn(address: string, tokenAmountIn: BigNumberish): Promise<TokenAmount> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const amountIn = bnum(tokenAmountIn);
    const token = this.getTokenByAddress(address);
    const poolAmountOut = calcPoolOutGivenSingleIn(
      token.usedBalance,
      token.usedDenorm,
      this.pool.totalSupply,
      this.pool.totalWeight,
      amountIn,
      this.pool.swapFee
    );
    return {
      address,
      symbol: token.symbol,
      amount: toHex(poolAmountOut),
      decimals: token.decimals,
      displayAmount: formatBalance(poolAmountOut, token.decimals, 4),
      ...this.getUserTokenData(address, amountIn)
    };
  }

  /**
   * Calculate the amount of each underlying token that must be provided to mint a given amount of pool tokens.
   * 
   * @param poolTokensToMint Amount of pool tokens to mint
   */
  async calcAllInGivenPoolOut(poolTokensToMint: BigNumberish): Promise<TokenAmount[]> {
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
        amount: toHex(amount),
        displayAmount: formatBalance(amount, partials[i].decimals, 4),
        ...(this.getUserTokenData(partials[i].address, amount))
      }
    ], []);
  }

  /**
   * Calculate the amount of a specific token that can be withdrawn by burning a given amount of pool tokens.
   * 
   * @param address Address of the token to withdraw
   * @param poolTokensToBurn Amount of pool tokens to burn
   */
  async calcSingleOutGivenPoolIn(address: string, poolTokensToBurn: BigNumberish): Promise<TokenAmount> {
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
      decimals: token.decimals,
    };
  }

  /**
   * Calculate the amount of pool tokens that would need to be burned to withdraw a given amount of a token.
   *
   * @param address Address of the token to withdraw
   * @param tokenAmountOut Amount of tokens to get out
   */
  async calcPoolInGivenSingleOut(address: string, tokenAmountOut: BigNumberish): Promise<TokenAmount> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const amountOut = bnum(tokenAmountOut);
    const token = this.getTokenByAddress(address);
    if (!token.ready) {
      throw Error(`Can not exit into token which is not initialized.`);
    }
    const poolAmountIn = calcPoolInGivenSingleOut(
      token.balance,
      token.denorm,
      this.pool.totalSupply,
      this.pool.totalWeight,
      amountOut,
      this.pool.swapFee
    );
    return {
      address,
      amount: toHex(poolAmountIn),
      symbol: token.symbol,
      displayAmount: formatBalance(poolAmountIn, token.decimals, 4),
      decimals: token.decimals
    };
  }

  /**
   * Calculate the amount of each underlying token that can be withdrawn by burning a given amount of pool tokens.
   *
   * @param poolTokensToBurn Number of pool tokens to burn
   */
  async calcAllOutGivenPoolIn(poolTokensToBurn: BigNumberish): Promise<TokenAmount[]> {
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

  async calcOutGivenIn(
    tokenIn_: string,
    tokenOut_: string,
    amountIn: BigNumberish
  ): Promise<TokenAmount & { spotPriceAfter: BigNumber }> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const tokenIn = this.getTokenByAddress(tokenIn_);
    const tokenOut = this.getTokenByAddress(tokenOut_);
    const amountOut = calcOutGivenIn(
      tokenIn.usedBalance,
      tokenIn.usedDenorm,
      tokenOut.balance,
      tokenOut.denorm,
      bnum(amountIn),
      this.pool.swapFee
    );
    const { symbol, address, decimals } = tokenOut;
    const spotPriceAfter = calcSpotPrice(
      tokenIn.usedBalance.plus(bnum(amountIn)),
      tokenIn.usedDenorm,
      tokenOut.usedBalance.minus(amountOut),
      tokenOut.usedDenorm,
      this.pool.swapFee
    );
    return {
      symbol,
      address,
      decimals,
      amount: toHex(amountOut),
      displayAmount: formatBalance(amountOut, decimals, 4),
      spotPriceAfter
    };
  }

  async calcInGivenOut(
    tokenIn_: string,
    tokenOut_: string,
    amountOut: BigNumberish
  ): Promise<TokenAmount & { spotPriceAfter: BigNumber }> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const tokenIn = this.getTokenByAddress(tokenIn_);
    const tokenOut = this.getTokenByAddress(tokenOut_);
    const amountIn = calcInGivenOut(
      tokenIn.usedBalance,
      tokenIn.usedDenorm,
      tokenOut.balance,
      tokenOut.denorm,
      bnum(amountOut),
      this.pool.swapFee
    );
    const { symbol, address, decimals } = tokenIn;
    const spotPriceAfter = calcSpotPrice(
      tokenIn.usedBalance.plus(amountIn),
      tokenIn.usedDenorm,
      tokenOut.usedBalance.minus(bnum(amountOut)),
      tokenOut.usedDenorm,
      this.pool.swapFee
    );
    return {
      symbol,
      address,
      decimals,
      amount: toHex(amountIn),
      displayAmount: formatBalance(amountIn, decimals, 4),
      spotPriceAfter
    };
  }
}