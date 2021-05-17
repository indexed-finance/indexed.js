import { BigNumber } from "../utils/bignumber";

export type NewStakingPool = {
  id: string;
  token: string;
  symbol: string;
  name: string;
  decimals: number;
  totalStaked: BigNumber;
  isPairToken: boolean;
  allocPoint: number;
  lastRewardBlock: number;
  userCount: number;
  updatedAt: number;
  rewardsPerDay: BigNumber;
  userStakedBalance?: BigNumber;
  userEarnedRewards?: BigNumber;
  userBalanceStakingToken?: BigNumber;
  userAllowanceStakingToken?: BigNumber;
}

export type NewStakingMeta = {
  id: string;
  owner: string;
  rewardsSchedule: string;
  startBlock: number;
  endBlock: number;
  rewardsToken: string;
  totalAllocPoint: number;
  poolCount: number;
}