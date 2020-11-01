import { getAddress } from "@ethersproject/address";

export type AddressLike = string | { address: string } | { options: { address: string } };

export function toAddress(obj: AddressLike): string {
  if (typeof obj == 'string') return obj;
  let _obj = obj as any;
  return _obj.address || _obj.options.address;
}

export function toChecksum(obj: AddressLike): string {
  return getAddress(toAddress(obj));
}