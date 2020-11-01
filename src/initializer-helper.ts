import { Provider, Web3Provider } from "@ethersproject/providers";
import { Contract } from "ethers";
import { bnum } from "./bmath";
import { UNISWAP_ORACLE, INITIALIZER_MIN_TWAP, INITIALIZER_MAX_TWAP } from "./constants";
import { PoolInitializer, InitializerToken, UninitializedPool } from "./types";
import { AddressLike, toAddress } from "./utils/address";
import { BigNumber, BigNumberish } from "./utils/bignumber";

const oracleAddress = '0x235F273f05Bb2129aD32377AA3E8257a55B1A3b9';

export class InitializerHelper {
  lastUpdate: number;
  waitForUpdate: Promise<void>;
  private provider: Provider;

  constructor(
    provider: any,
    public pool: UninitializedPool
  ) {
    if (Object.keys(provider).includes('currentProvider')) {
      this.provider = new Web3Provider(provider.currentProvider);
    } else {
      this.provider = provider;
    }
    this.lastUpdate = 0;
    this.waitForUpdate = this.update();
  }

  get initializer(): PoolInitializer {
    return this.pool.initializer;
  }

  get tokens(): InitializerToken[] {
    return this.initializer.tokens;
  }

  get shouldUpdate(): boolean {
    const timestamp = Math.floor(+new Date() / 1000);
    return timestamp - this.lastUpdate > 600;
  }

  get totalCreditedWETH(): BigNumber {
    return this.initializer.totalCreditedWETH;
  }

  async update(): Promise<void> {
    const initializerAbi = require('./abi/IPoolInitializer.json');
    const initializer = new Contract(this.initializer.address, initializerAbi, this.provider);
    const desiredAmounts = await initializer.getDesiredAmounts(this.tokens.map(t => t.address));
    desiredAmounts.forEach((amount, i) => {
      const token = this.tokens[i];
      const targetBalance = token.targetBalance;
      const balance = targetBalance.minus(amount);
      token.amountRemaining = amount;
      token.balance = balance;
    });
    this.lastUpdate = Math.floor(+new Date() / 1000);
  }

  async getExpectedCredit(token: AddressLike, amount: BigNumberish): Promise<BigNumber> {
    const oracleAbi = require('./abi/IIndexedUniswapV2Oracle.json');
    const oracle = new Contract(UNISWAP_ORACLE, oracleAbi, this.provider);
    const amountIn = bnum(amount);
    const ethValue = await oracle['computeAverageEthForTokens(address,uint256,uint256,uint256)'](
      toAddress(token),
      amountIn,
      INITIALIZER_MIN_TWAP,
      INITIALIZER_MAX_TWAP
    );
    return ethValue;
  }

  async getExpectedCredits(tokens: AddressLike[], amounts: BigNumberish[]): Promise<BigNumber> {
    const oracleAbi = require('./abi/IIndexedUniswapV2Oracle.json');
    const oracle = new Contract(UNISWAP_ORACLE, oracleAbi, this.provider);
    const amountsIn = amounts.map(bnum);
    const ethValues = await oracle['computeAverageEthForTokens(address[],uint256[],uint256,uint256)'](
      tokens.map(toAddress),
      amountsIn,
      INITIALIZER_MIN_TWAP,
      INITIALIZER_MAX_TWAP
    );
    return ethValues;
  }
}