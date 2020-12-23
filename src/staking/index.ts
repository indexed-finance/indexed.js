import { Provider } from "@ethersproject/providers";
import { toProvider } from "../utils/provider";
import { bnum } from '../bmath';
import { StakingPool } from '../types';
import { BigNumber } from '../utils/bignumber';
import { getStakingRewardsData } from "./multicall";

export class StakingPoolHelper {
  protected lastUpdate: number = 0;
  public updatePromise: Promise<void>;

  public provider: Provider;
  public userBalanceRewards?: BigNumber;
  public userEarnedRewards?: BigNumber;
  public userBalanceStakingToken?: BigNumber;
  public userAllowanceStakingToken?: BigNumber;

  constructor(
    provider: any,
    public chainID: number,
    public pool: StakingPool,
    public userAddress?: string
  ) {
    this.provider = toProvider(provider);
  }

  get stakingToken(): string {
    return this.pool.stakingToken;
  }

  get rewardsAddress(): string {
    return this.pool.address;
  }

  get rewardsFactoryAddress(): string {
    return this.chainID == 1
      ? '0x48887E27e3E42e769F34e1e43E857235035d333a'
      : '0x8d12A344580Bc0bC4E684248067F5d9d3908C864';
  }

  get shouldUpdate(): boolean {
    const timestamp = Math.floor(+new Date() / 1000);
    return timestamp - this.lastUpdate > 300;
  }

  async waitForUpdate(): Promise<void> {
    if (this.shouldUpdate) {
      this.updatePromise = this.updatePool();
      this.lastUpdate = Math.floor(+new Date() / 1000);
    }
    await this.updatePromise;
  }

  setUserAddress(address: string) {
    this.userAddress = address;
    this.updatePromise = this.updatePool();
    this.lastUpdate = Math.floor(+new Date() / 1000);
  }

  async updatePool(): Promise<void> {
    const update = await getStakingRewardsData(this.provider, this.pool, this.rewardsFactoryAddress, this.userAddress);
    const {
      active,
      isReady,
      hasBegun,
      totalSupply,
      rewardsDuration,
      periodStart,
      periodFinish,
      lastUpdateTime,
      claimedRewards,
      rewardRate,
      userBalanceRewards,
      userEarnedRewards,
      userBalanceStakingToken,
      userAllowanceStakingToken
    } = update;
    this.userBalanceRewards = userBalanceRewards;
    this.userEarnedRewards = userEarnedRewards;
    this.userBalanceStakingToken = userBalanceStakingToken;
    this.userAllowanceStakingToken = userAllowanceStakingToken;
    Object.assign(this.pool, {
      active,
      hasBegun,
      isReady,
      totalSupply,
      rewardsDuration,
      periodStart,
      periodFinish,
      lastUpdateTime,
      claimedRewards,
      rewardRate,
    });
  }

  async calculateRewardsForDuration(duration: number): Promise<BigNumber> {
    await this.waitForUpdate();
    return this.pool.rewardRate.times(duration);
  }
}