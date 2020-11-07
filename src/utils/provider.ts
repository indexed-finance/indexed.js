import { Provider, Web3Provider } from '@ethersproject/providers';

export function toProvider(provider: any): Provider {
  if (Object.keys(provider).includes('currentProvider')) {
    return new Web3Provider(provider.currentProvider);
  } else {
    return provider;
  }
}