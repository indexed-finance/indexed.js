import { Provider } from "@ethersproject/providers";
import { toProvider } from "./utils/provider";
import { BigNumber, BigNumberish, formatBalance, toBN } from './utils/bignumber';
import { UniswapPairData } from './types';
import { getUniswapData } from "./multicall";
import { AddressLike, computeUniswapPairAddress, toAddress } from "./utils/address";

type Token = {
  address: string;
  decimals: number;
  symbol: string;
}

function getAmountOut(amountIn: BigNumber, reserveIn: BigNumber, reserveOut: BigNumber): BigNumber {
  const amountInWithFee = amountIn.times(997);
  const numerator = amountInWithFee.times(reserveOut);
  const denominator = reserveIn.times(1000).plus(amountInWithFee);
  return numerator.div(denominator);
}

function getAmountIn(amountOut: BigNumber, reserveIn: BigNumber, reserveOut: BigNumber): BigNumber {
  const numerator = reserveIn.times(amountOut).times(1000);
  const denominator = reserveOut.minus(amountOut).times(997);
  return numerator.div(denominator).plus(1);
}

type TokenAmount = {
  amount: BigNumber;
  displayAmount: string;
}

export class UniswapHelper {
  lastUpdate: number;
  waitForUpdate: Promise<void>;
  public provider: Provider;
  public tokenABalance?: BigNumber;
  public ethBalance?: BigNumber;
  public tokens: Token[];
  public pairs: UniswapPairData[];

  constructor(
    provider: any,
    public tokenA: Token,
    public tokenWhitelist: Token[],
    public userAddress?: string
  ) {
    this.provider = toProvider(provider);
    this.lastUpdate = 0;
    this.waitForUpdate = this.setValidPairs();
  }

  get shouldUpdate(): boolean {
    const timestamp = Math.floor(+new Date() / 1000);
    return timestamp - this.lastUpdate > 600;
  }

  async update(): Promise<void> {
    const uniData = await getUniswapData(this.provider, this.tokenA, this.tokenWhitelist, this.userAddress);
    const ethBalance = await this.provider.getBalance(this.userAddress);

    this.pairs = uniData.pairs;
    this.ethBalance = toBN(ethBalance);
    this.tokenABalance = uniData.tokenABalance;
  }

  private async setValidPairs(): Promise<void> {
    let tokensWithPairs: Token[] = [];
    const proms = this.tokenWhitelist.map(async (token) => {
      const pairAddress = computeUniswapPairAddress(this.tokenA.address, token.address);
      const code = await this.provider.getCode(pairAddress);
      if (!code || code == '0x') return null;
      tokensWithPairs.push(token);;
    })
    await Promise.all(proms);
    this.tokens = tokensWithPairs;
    await this.update();
  }

  public setUserAddress(address: string): void {
    this.userAddress = address;
    this.waitForUpdate = this.update();
  }

  public getTokenInfo(token: AddressLike): Token {
    const address = toAddress(token);
    if (address.toLowerCase() == this.tokenA.address.toLowerCase()) {
      return this.tokenA;
    }
    return this.tokens.find((t) => t.address.toLowerCase() == address.toLowerCase());
  }

  public getPairForToken(tokenB_: AddressLike): UniswapPairData {
    const tokenB = toAddress(tokenB_);
    return this.pairs.find((p) => p.tokenB.toLowerCase() == tokenB.toLowerCase());
  }

  async getAmountOut(tokenInAddress: string, tokenOutAddress: string, amountIn: BigNumberish): Promise<TokenAmount> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const tokenIn = this.getTokenInfo(tokenInAddress);
    const tokenOut = this.getTokenInfo(tokenOutAddress);
    const tokenAmountIn = toBN(amountIn);
    let pair: UniswapPairData;
    if (tokenIn.address == this.tokenA.address) {
      pair = this.getPairForToken(tokenOutAddress);
      const amountOut = getAmountOut(tokenAmountIn, pair.reservesA, pair.reservesB);
      return {
        amount: amountOut,
        displayAmount: formatBalance(amountOut, tokenOut.decimals, 4)
      };
    } else {
      pair = this.getPairForToken(tokenInAddress);
      const amountOut = getAmountOut(tokenAmountIn, pair.reservesB, pair.reservesA);
      return {
        amount: amountOut,
        displayAmount: formatBalance(amountOut, tokenOut.decimals, 4)
      };
    }
  }

  async getAmountIn(tokenInAddress: string, tokenOutAddress: string, amountOut: BigNumberish): Promise<TokenAmount> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const tokenIn = this.getTokenInfo(tokenInAddress);
    const tokenAmountOut = toBN(amountOut);
    let pair: UniswapPairData;
    // tokenB is the searchable one
    if (tokenIn.address == this.tokenA.address) {
      pair = this.getPairForToken(tokenOutAddress);
      const amountIn = getAmountIn(tokenAmountOut, pair.reservesA, pair.reservesB);
      return {
        amount: amountIn,
        displayAmount: formatBalance(amountIn, tokenIn.decimals, 4)
      };
    } else {
      pair = this.getPairForToken(tokenInAddress);
      const amountIn = getAmountIn(tokenAmountOut, pair.reservesB, pair.reservesA);
      return {
        amount: amountIn,
        displayAmount: formatBalance(amountIn, tokenIn.decimals, 4)
      };
    }
  }
}
