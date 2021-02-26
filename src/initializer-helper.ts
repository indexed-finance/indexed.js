import { Provider } from "@ethersproject/providers";
import { Contract } from "ethers";
import { getTokenUserData } from "./multicall";
import { bnum } from "./bmath";
import { INITIALIZER_MIN_TWAP, INITIALIZER_MAX_TWAP } from "./constants";
import { PoolInitializer, InitializerToken, UninitializedPool } from "./types";
import { AddressLike, toAddress } from "./utils/address";
import { BigNumber, BigNumberish, formatBalance, toHex } from "./utils/bignumber";
import deployments from './deployments';
import { toProvider } from "./utils/provider";

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

const MAX_UINT112 = new BigNumber(2).pow(112);
const fromFP = (num: BigNumber) => num.div(MAX_UINT112);

export class InitializerHelper {
  lastUpdate: number;
  waitForUpdate: Promise<void>;
  public provider: Provider;
  public tokenPrices: { [key: string]: BigNumber } = {};
  public userAllowances: { [key: string]: BigNumber } = {};
  public userBalances: { [key: string]: BigNumber } = {};
  public userCredit: BigNumber = bnum(0);

  constructor(
    provider: any,
    public chainID: number,
    public pool: UninitializedPool,
    public userAddress?: string
  ) {
    this.provider = toProvider(provider);
    this.lastUpdate = 0;
    this.waitForUpdate = this.update();
  }

  get category(): string {
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
    return timestamp - this.lastUpdate > 120;
  }

  get totalCreditedWETH(): BigNumber {
    return this.initializer.totalCreditedWETH;
  }

  setUserAddress(userAddress: string) {
    this.userAddress = userAddress;
    this.waitForUpdate = this.update();
  }

  async getOracle(): Promise<Contract> {
    const network = this.chainID == 1 ? 'mainnet' : 'rinkeby';
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

  async getPrices(tokens_: AddressLike[]): Promise<BigNumber[]> {
    const tokens = tokens_.map(toAddress);
    const oracle = await this.getOracle();

    try {
      const prices = await oracle.computeAverageTokenPrices(
        tokens,
        INITIALIZER_MIN_TWAP,
        INITIALIZER_MAX_TWAP
      );
      const fpValues = prices.map(p => fromFP(bnum(p._x)));
      return fpValues;
    } catch (e) {
      console.log(e)
      const emptyArray = new Array(tokens.length);
      return emptyArray.fill(new BigNumber(0));
    }
  }

  async updateUserData(): Promise<void> {
    if (!this.userAddress) return;
    const tokens = this.tokens;
    const tokenDatas = await getTokenUserData(this.provider, this.userAddress, this.initializer.address, tokens);
    const abi = require('./abi/IPoolInitializer.json');
    let pool = new Contract(this.initializer.address, abi, this.provider);
    this.userCredit = bnum(await pool.getCreditOf(this.userAddress));
    tokenDatas.forEach(({ allowance, balance }, i) => {
      const address = tokens[i].address;
      this.userAllowances[address] = allowance;
      this.userBalances[address] = balance;
    });
  }

  async updateTokens(): Promise<void> {
    const initializerAbi = require('./abi/IPoolInitializer.json');
    const initializer = new Contract(this.initializer.address, initializerAbi, this.provider);
    const tokens = this.tokens.map(t => t.address);
    const desiredAmounts = (await initializer.getDesiredAmounts(tokens, { gasLimit: 1000000 })).map(bnum);
    const prices = await this.getPrices(tokens);

    desiredAmounts.forEach((amount, i) => {
      const token = this.tokens[i];
      const targetBalance = token.targetBalance;
      const balance = targetBalance.minus(amount);
      token.amountRemaining = amount;
      token.balance = balance;
      this.tokenPrices[tokens[i]] = prices[i];
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

  async getExpectedCredit(token_: AddressLike, amount_: BigNumberish): Promise<CreditAmount & TokenDetails> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const amount = bnum(amount_);
    const address = toAddress(token_);
    const token = this.getTokenByAddress(address);
    const credit = this.tokenPrices[address.toLowerCase()].times(amount);
    return {
      credit: toHex(credit),
      displayCredit: formatBalance(credit, 18, 4),
      address: token.address,
      decimals: token.decimals,
      ...this.getUserTokenData(token.address, amount)
    };
  }

  async getExpectedCredits(tokens_: AddressLike[], amounts: BigNumberish[]): Promise<[CreditAmount, TokenDetails[]]> {
    if (this.shouldUpdate) {
      this.waitForUpdate = this.update();
    }
    await this.waitForUpdate;
    const tokens = tokens_.map(toAddress);
    const amountsIn = amounts.map(bnum);
    const details: TokenDetails[] = [];
    let credit = bnum(0);
    tokens.forEach((tokenAddress, i) => {
      const token = this.getTokenByAddress(tokenAddress);
      details.push({
        address: token.address,
        decimals: token.decimals,
        ...this.getUserTokenData(token.address, amountsIn[i])
      })
    });

    tokens.forEach((token, i) => {
      const price = this.tokenPrices[token];
      const amount = amountsIn[i];
      credit = credit.plus(price.times(amount))
    });

    return [
      {
        credit: toHex(credit),
        displayCredit: formatBalance(credit, 18, 4)
      },
      details
    ];
  }
}
