import { getJSON } from './fetch';

export const gwei = 1000000000;

export async function getGasPrice(chainID: number): Promise<number> {
  if (chainID === 1) {
    const { standard } = await getJSON('https://www.etherchain.org/api/gasPriceOracle');
    return standard * gwei;
  }
  return gwei;
}