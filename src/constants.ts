import { getAddress } from "ethers/lib/utils";

export const INITIALIZER_MIN_TWAP = 1;
export const INITIALIZER_MAX_TWAP = 43200 * 200;
export const UNISWAP_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
export const UNISWAP_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
export const getWethAddress = (network: 'mainnet' | 'rinkeby') => getAddress(
  network == 'mainnet'
    ? '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    : '0xdD94a710009CD1d859fd48D5eb29A1a49dD6135f'
);
export const zeroAddress = `0x${'00'.repeat(20)}`;

export const SIGMA_REWARDS_FACTORY = '0x4246863cf318f930a955f4bab2a9277c21e3b0bb';
export const DEGEN = '0x126c121f99e1e211df2e5f8de2d96fa36647c855';