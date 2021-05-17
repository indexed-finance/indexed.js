import { getJSON } from './fetch';

export const gwei = 1000000000;

export async function getGasPrice(network: 'mainnet' | 'rinkeby'): Promise<number> {
  if (network === 'mainnet') {
    const { standard } = await getJSON('https://www.etherchain.org/api/gasPriceOracle');
    return standard * gwei;
  }
  return gwei;
}