import { ethers } from 'ethers';
import { config } from '../config';

let provider: ethers.JsonRpcProvider;
let wallet: ethers.Wallet;

export function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(config.ethereumRpcUrl);
  }
  return provider;
}

export function getWallet(): ethers.Wallet {
  if (!wallet) {
    wallet = new ethers.Wallet(config.botPrivateKey, getProvider());
  }
  return wallet;
}

export async function getWalletAddress(): Promise<string> {
  return getWallet().address;
}

export async function getBlockNumber(): Promise<number> {
  return getProvider().getBlockNumber();
}
