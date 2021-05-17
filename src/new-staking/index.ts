import { getNewStakingInfo } from '../subgraph'
import { BigNumber, BigNumberish, toBN } from '../utils/bignumber';
import { NewStakingMeta, NewStakingPool } from './types';
import { CallInput, MultiCall } from '@indexed-finance/multicall';
import { Provider } from '@ethersproject/providers';
import { toProvider } from "../utils/provider";
import { AllStakingInfoData } from '@indexed-finance/subgraph-clients/dist/staking/types'
import { Interface } from '@ethersproject/abi';

import RewardsSchedule from '../abi/RewardsSchedule.json'
import MultiTokenStaking from '../abi/MultiTokenStaking.json'
import IERC20 from '../abi/IERC20.json'
import { BONE } from '../bmath';

const BLOCKS_PER_DAY = 86400 / 13.5;

export class NewStakingHelper {
  protected lastUpdate: number = 0;
  public updatePromise: Promise<void>;
  public meta: NewStakingMeta;
  public pools: NewStakingPool[] = [];
  public totalRewardsPerDay: BigNumber;
  public provider: Provider;

  get shouldUpdate(): boolean {
    const timestamp = Math.floor(+new Date() / 1000);
    return timestamp - this.lastUpdate > 120;
  }

  async waitForUpdate(): Promise<void> {
    if (this.shouldUpdate) {
      this.updatePromise = this.update();
      this.lastUpdate = Math.floor(+new Date() / 1000);
    }
    await this.updatePromise;
  }

  constructor(
    provider: any,
    public network: 'mainnet' | 'rinkeby',
    stakingPoolInfo: AllStakingInfoData,
    public userAddress?: string
  ) {
    this.provider = toProvider(provider);
    const { pools, ...meta } = stakingPoolInfo;
    this.meta = meta;
    this.pools = pools.map(({ balance, ...p }) => ({ ...p, totalStaked: toBN(balance), rewardsPerDay: toBN(0) }))
    this.updatePromise = this.update();
    this.lastUpdate = Math.floor(+new Date() / 1000);
  }

  setUserAddress(address: string) {
    this.userAddress = address;
    this.updatePromise = this.update();
    this.lastUpdate = Math.floor(+new Date() / 1000);
  }

  static async create(provider: Provider, userAddress?: string) {
    const network = (await provider.getNetwork()).name as 'mainnet' | 'rinkeby';
    const info = await getNewStakingInfo(network)
    return new NewStakingHelper(provider, network, info, userAddress);
  }

  async update() {
    const calls: CallInput[] = [];
    const fromBlock = [...this.pools].sort((a, b) => b.lastRewardBlock - a.lastRewardBlock)[0].lastRewardBlock;
    const toBlock = fromBlock + BLOCKS_PER_DAY;
    calls.push({
      target: this.meta.rewardsSchedule,
      function: 'getRewardsForBlockRange',
      args: [fromBlock, toBlock],
      interface: new Interface(RewardsSchedule)
    })
    const MultiTokenStakingInterface = new Interface(MultiTokenStaking)
    const IERC20Interface = new Interface(IERC20)
    for (let pool of this.pools) {
      calls.push({
        target: this.meta.id,
        function: 'poolInfo',
        args: [pool.id],
        interface: MultiTokenStakingInterface
      })
      calls.push({
        target: pool.token,
        function: 'balanceOf',
        interface: IERC20Interface,
        args: [this.meta.id]
      })
      if (this.userAddress) {
        calls.push({
          target: this.meta.id,
          function: 'userInfo',
          args: [pool.id, this.userAddress],
          interface: MultiTokenStakingInterface
        })
        calls.push({
          target: this.meta.id,
          function: 'pendingRewards',
          args: [pool.id, this.userAddress],
          interface: MultiTokenStakingInterface
        })
        calls.push({
          target: pool.token,
          function: 'balanceOf',
          interface: IERC20Interface,
          args: [this.userAddress]
        })
        calls.push({
          target: pool.token,
          function: 'allowance',
          interface: IERC20Interface,
          args: [this.userAddress, this.meta.id]
        })
      }
    }
    const multi = new MultiCall(this.provider);
    const result = await multi.multiCall(calls);
    this.totalRewardsPerDay = toBN(result[0]);
    this.meta.totalAllocPoint = 0;
    let increment = this.userAddress ? 6 : 2;
    for (let i = 0; i < this.pools.length; i++) {
      const rI = i * increment;
      const pool = this.pools[i]
      const poolInfo = result[rI + 1];
      this.pools[i].lastRewardBlock = +(poolInfo[1]);
      const allocPoint = +(poolInfo[2]);
      pool.allocPoint = allocPoint;
      this.meta.totalAllocPoint += allocPoint;
      pool.totalStaked = toBN(result[rI + 2]);
      if (this.userAddress) {
        const userInfo = result[rI + 3];
        pool.userStakedBalance = toBN(userInfo[0])
        pool.userEarnedRewards = toBN(result[rI + 4])
        pool.userBalanceStakingToken = toBN(result[rI + 5])
        pool.userAllowanceStakingToken = toBN(result[rI + 6])
      }
    }
    for (let pool of this.pools) {
      pool.rewardsPerDay = this.totalRewardsPerDay.times(pool.allocPoint / this.meta.totalAllocPoint);
    }
  }

  calculateTotalRewardsForDuration(duration: number): BigNumber {
    return this.totalRewardsPerDay.times(duration).div(86400);
  }

  calculateRewardsForDuration(pid: number, duration: number, stakedAmount: BigNumberish = BONE): BigNumber {
    const pool = this.pools[pid];
    const staked = toBN(stakedAmount);
    const poolRewardsForDuration = pool.rewardsPerDay.times(duration).div(86400)
    return poolRewardsForDuration.times(staked).div(pool.totalStaked)
  }
}