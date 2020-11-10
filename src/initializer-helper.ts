import { Provider, Web3Provider } from "@ethersproject/providers";
import { Contract } from "ethers";
import { getTokenUserData } from "./multicall";
import { bnum } from "./bmath";
import { INITIALIZER_MIN_TWAP, INITIALIZER_MAX_TWAP } from "./constants";
import { PoolInitializer, InitializerToken, UninitializedPool } from "./types";
import { AddressLike, toAddress } from "./utils/address";
import { BigNumber, BigNumberish, formatBalance, toHex } from "./utils/bignumber";
import deployments from './deployments';
import { toProvider } from "./utils/provider";

const oracleAddress = '0x235F273f05Bb2129aD32377AA3E8257a55B1A3b9';

type CreditAmount = {
  credit: string;
  displayCredit: string;
}

type TokenDetails = {
  address: string;
  decimals: number;
  remainingApprovalAmount?: string;
  balance?: string;
  allowance?: string;
}

export class InitializerHelper {
  lastUpdate: number;
  waitForUpdate: Promise<void>;
  private provider: Provider;
  public userAllowances?: { [key: string]: BigNumber };
  public userBalances?: { [key: string]: BigNumber };
  private network?: string;

  constructor(
    provider: any,
    public pool: UninitializedPool,
    public userAddress?: string
  ) {
    this.provider = toProvider(provider);
    this.lastUpdate = 0;
    if (this.userAddress) {
      this.userAllowances = {};
      this.userBalances = {};
    }
    this.waitForUpdate = this.update();
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
    return this.initializer.address;
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

  setUserAddress(userAddress: string) {
    this.userAddress = userAddress;
    this.userAllowances = {};
    this.userBalances = {};
    this.waitForUpdate = this.update();
  }

  async getOracle(): Promise<Contract> {
    if (!this.network) {
      this.network = await this.provider.getNetwork().then(n => n.name);
    }
    const network = this.network;
    const oracleAddress = deployments[network].uniswapOracle;
    const oracleABI = require('./abi/IIndexedUniswapV2Oracle.json');
    return new Contract(oracleAddress, oracleABI, this.provider);
  }

  getTokenBySymbol(symbol: string): InitializerToken {
    for (let token of this.tokens) {
      if (token.symbol.toLowerCase() == symbol.toLowerCase()) {
        return token;
      }
    }
    throw new Error(`Token with symbol ${symbol} not found in pool.`);
  }

  getTokenByAddress(address: string): InitializerToken {
    for (let token of this.tokens) {
      if (token.address.toLowerCase() == address.toLowerCase()) {
        return token;
      }
    }
    throw new Error(`Token with address ${address} not found in pool.`);
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

  async updateUserData(): Promise<void> {
    if (!this.userAddress) return;
    const tokens = this.tokens;
    const tokenDatas = await getTokenUserData(this.provider, this.userAddress, this.initializer.address, tokens);
    tokenDatas.forEach(({ allowance, balance }, i) => {
      const address = tokens[i].address;
      this.userAllowances[address] = allowance;
      this.userBalances[address] = balance;
    });
  }

  async updateTokens(): Promise<void> {
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
  }

  async update(): Promise<void> {
    this.lastUpdate = Math.floor(+new Date() / 1000);
    await Promise.all([ this.updateTokens(), this.updateUserData() ]);
  }

  async checkTokenPriceReady(token_: AddressLike): Promise<boolean> {
    const oracle = await this.getOracle();
    try {
      await oracle['computeAverageEthForTokens(address,uint256,uint256,uint256)'](
        toAddress(token_),
        0,
        INITIALIZER_MIN_TWAP,
        INITIALIZER_MAX_TWAP
      );
      return true;
    } catch (err) {
      return false;
    }
  }

  async updatePrice(token: AddressLike): Promise<void> {
    const oracle = await this.getOracle();
    await oracle.updatePrice(toAddress(token)).then(tx => tx.wait());
  }

  async getExpectedCredit(token_: AddressLike, amount: BigNumberish): Promise<CreditAmount & TokenDetails> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const oracle = await this.getOracle();
    const token = this.getTokenByAddress(toAddress(token_));
    const credit = await oracle['computeAverageEthForTokens(address,uint256,uint256,uint256)'](
      token.address,
      `0x` + amount.toString(16),
      INITIALIZER_MIN_TWAP,
      INITIALIZER_MAX_TWAP
    );
    return {
      credit: toHex(bnum(credit)),
      displayCredit: formatBalance(bnum(credit), 18, 4),
      address: token.address,
      decimals: token.decimals,
      ...this.getUserTokenData(token.address, bnum(amount))
    };
  }

  async getExpectedCredits(tokens: AddressLike[], amounts: BigNumberish[]): Promise<[CreditAmount, TokenDetails[]]> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const oracle = await this.getOracle();
    const amountsIn = amounts.map(bnum);
    const details: TokenDetails[] = [];
    tokens.forEach((token_, i) => {
      const token = this.getTokenByAddress(toAddress(token_));
      details.push({
        address: token.address,
        decimals: token.decimals,
        ...this.getUserTokenData(token.address, amountsIn[i])
      })
    });
    const ethValue = await oracle['computeAverageEthForTokens(address[],uint256[],uint256,uint256)'](
      tokens.map(toAddress),
      amountsIn.map(amount => `0x` + amount.toString(16)),
      INITIALIZER_MIN_TWAP,
      INITIALIZER_MAX_TWAP
    );
    const credit = ethValue.reduce((total, value) => total.plus(bnum(value)), bnum(0));

    return [
      {
        credit: toHex(credit),
        displayCredit: formatBalance(credit, 18, 4)
      },
      details
    ];
  }
}