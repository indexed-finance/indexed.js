import { Provider } from "@ethersproject/providers";
import { toProvider } from "../utils/provider";
import { BONE } from '../bmath';
import { StakingPool } from '../types';
import { BigNumber, BigNumberish, toBN } from '../utils/bignumber';
import { getStakingRewardsData } from "./multicall";
import { DEGEN, SIGMA_REWARDS_FACTORY } from '../constants';

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
    public network: 'mainnet' | 'rinkeby',
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
    if (this.pool.indexPool.toLowerCase() == DEGEN.toLowerCase()) {
      return SIGMA_REWARDS_FACTORY;
    }
    return this.network == 'mainnet'
      ? '0x48887E27e3E42e769F34e1e43E857235035d333a'
      : '0x8d12A344580Bc0bC4E684248067F5d9d3908C864';
  }

  get shouldUpdate(): boolean {
    const timestamp = Math.floor(+new Date() / 1000);
    return timestamp - this.lastUpdate > 120;
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
      rewardPerToken,
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
      rewardPerToken
    });
  }

  calculateTotalRewardsForDuration(duration: number): BigNumber {
    return this.pool.rewardRate.times(duration);
  }

  calculateRewardsForDuration(duration: number, stakedAmount: BigNumberish = BONE): BigNumber {
    const staked = toBN(stakedAmount);
    return this.pool.rewardRate.times(duration).times(staked).div(this.pool.totalSupply);
  }
}