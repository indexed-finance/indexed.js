import { BigNumber } from "bignumber.js";
import { bnum, scale } from "../bmath";
import { BigNumberish as eBigNumberish } from "ethers";
import { formatEther } from "ethers/lib/utils";

BigNumber.config({
  EXPONENTIAL_AT: [-100, 100],
  ROUNDING_MODE: 1,
  DECIMAL_PLACES: 18,
});

export type BigNumberish = eBigNumberish | BigNumber;

export { BigNumber };

export const toBN = (num: BigNumberish): BigNumber => bnum(num);

export function toWei(val: BigNumberish): BigNumber {
  return scale(bnum(val.toString()), 18).integerValue();
}

export function fromWei(val: BigNumberish): string {
  return formatEther(val.toString());
}

export function toTokenAmount(val: BigNumberish, decimals: number): BigNumber {
  return scale(bnum(val.toString()), decimals).integerValue();
}

export function toHex(val: BigNumber): string {
  return `0x${val.integerValue().toString(16)}`;
}

export const formatBalance = (
  balance: BigNumber,
  decimals: number,
  precision: number
): string => {
  if (balance.eq(0)) {
    return bnum(0).toFixed(2);
  }

  const result = scale(balance, -decimals)
    .decimalPlaces(precision, BigNumber.ROUND_DOWN)
    .toString();

  return padToDecimalPlaces(result, 2);
};

export const padToDecimalPlaces = (
  value: string,
  minDecimals: number
): string => {
  const split = value.split(".");
  const zerosToPad = split[1] ? minDecimals - split[1].length : minDecimals;

  if (zerosToPad > 0) {
    let pad = "";

    // Add decimal point if no decimal portion in original number
    if (zerosToPad === minDecimals) {
      pad += ".";
    }
    for (let i = 0; i < zerosToPad; i++) {
      pad += "0";
    }
    return value + pad;
  }
  return value;
};
