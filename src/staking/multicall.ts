import { Provider } from '@ethersproject/providers';
import { Interface } from '@ethersproject/abi';
import { CallInput, MultiCall } from '@indexed-finance/multicall';
import { StakingPool } from '../types';
import { BigNumber } from '../utils/bignumber';
import { bnum } from '../bmath';

const rewardsABI = require('../abi/StakingRewards.json');
const erc20ABI = require('../abi/IERC20.json');
const factoryABI = require('../abi/StakingRewardsFactory.json');

export interface StakingPoolUpdate {
  active: boolean;
  isReady: boolean;
  hasBegun: boolean;

  totalSupply: BigNumber;
  rewardsDuration: number;
  periodStart: number;
  periodFinish: number;
  lastUpdateTime: number;
  claimedRewards: BigNumber;
  rewardRate: BigNumber;
  rewardPerToken: BigNumber;

  userBalanceRewards?: BigNumber;
  userEarnedRewards?: BigNumber;
  userBalanceStakingToken?: BigNumber;
  userAllowanceStakingToken?: BigNumber;
}

export async function getStakingRewardsData(
  provider: Provider,
  pool: StakingPool,
  factoryAddress: string,
  userAddress?: string
): Promise<StakingPoolUpdate> {
  const iface = new Interface(rewardsABI);
  const multi = new MultiCall(provider);
  const calls: CallInput[] = [];
  calls.push({ interface: iface, target: pool.address, function: 'rewardsDuration' });
  calls.push({ interface: iface, target: pool.address, function: 'periodFinish' });
  calls.push({ interface: iface, target: pool.address, function: 'rewardRate' });
  calls.push({ interface: iface, target: pool.address, function: 'lastUpdateTime' });
  calls.push({ interface: iface, target: pool.address, function: 'totalSupply' });
  calls.push({ interface: erc20ABI, target: pool.stakingToken, function: 'balanceOf', args: [pool.address] });
  calls.push({ interface: factoryABI, target: factoryAddress, function: 'stakingRewardsGenesis' });
  calls.push({ interface: iface, target: pool.address, function: 'rewardPerToken' });
  if (userAddress) {
    calls.push({ interface: iface, target: pool.address, function: 'balanceOf', args: [userAddress] });
    calls.push({ interface: iface, target: pool.address, function: 'earned', args: [userAddress] });
    calls.push({ interface: erc20ABI, target: pool.stakingToken, function: 'balanceOf', args: [userAddress] });
    calls.push({ interface: erc20ABI, target: pool.stakingToken, function: 'allowance', args: [userAddress, pool.address] });
  }
  const response = await multi.multiCall(calls);
  const rewardsDuration = bnum(response[0]).toNumber();
  const periodFinish = bnum(response[1]).toNumber();
  const rewardRate = bnum(response[2]);
  const lastUpdateTime = bnum(response[3]).toNumber();
  const totalSupply = bnum(response[4]);
  const poolRewardsBalance = bnum(response[5]);
  const stakingRewardsGenesis = bnum(response[6]).toNumber();
  const timestamp = new Date().getTime() / 1000;
  const isReady = timestamp >= stakingRewardsGenesis;
  const active = periodFinish > 0 && lastUpdateTime < periodFinish;
  const hasBegun = periodFinish > 0;
  const claimedRewards = hasBegun ? pool.totalRewards.minus(poolRewardsBalance) : bnum(0);
  const periodStart = hasBegun ? periodFinish - rewardsDuration : 0;
  const rewardPerToken = bnum(response[7]);
  const update: StakingPoolUpdate = {
    active,
    isReady,
    hasBegun,
    rewardsDuration,
    periodStart,
    periodFinish,
    lastUpdateTime,
    totalSupply,
    claimedRewards,
    rewardRate,
    rewardPerToken
  };
  if (userAddress) {
    update.userBalanceRewards = bnum(response[8]);
    update.userEarnedRewards = bnum(response[9]);
    update.userBalanceStakingToken = bnum(response[10]);
    update.userAllowanceStakingToken = bnum(response[11]);
  }
  return update;
}