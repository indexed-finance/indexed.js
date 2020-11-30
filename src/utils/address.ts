import { getAddress, getCreate2Address } from "@ethersproject/address";
import { keccak256 } from "ethers/lib/utils";
import { UNISWAP_FACTORY } from "../constants";

export type AddressLike = string | { address: string } | { options: { address: string } };

export function toAddress(obj: AddressLike): string {
  if (typeof obj == 'string') return obj;
  let _obj = obj as any;
  return _obj.address || _obj.options.address;
}

export function toChecksum(obj: AddressLike): string {
  return getAddress(toAddress(obj));
}

const addressToBuffer = (address: string): Buffer => Buffer.from(address.slice(2).padStart(40, '0'), 'hex');

export function sortTokens(tokenA: string, tokenB: string): string[] {
  return (tokenA.toLowerCase() < tokenB.toLowerCase()) ? [tokenA, tokenB] : [tokenB, tokenA];
}

export function computeUniswapPairAddress(tokenA: string, tokenB: string): string {
  const initCodeHash = '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f';
  const [token0, token1] = sortTokens(tokenA, tokenB);
  const salt = keccak256(
    Buffer.concat([addressToBuffer(token0), addressToBuffer(token1)])
  );
  return getCreate2Address(UNISWAP_FACTORY, salt, initCodeHash);
}