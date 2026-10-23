/**
 * Dynamic gas estimation with a +25% safety buffer.
 *
 * Calls eth_estimateGas through the viem public client, multiplies the result
 * by 1.25, and falls back to a generous constant if estimation fails (e.g. the
 * node returns an error for a call that will succeed onchain).
 *
 * Usage:
 *   const gas = await estimateGas(publicClient, { address, abi, functionName, args, account })
 *   writeContract({ address, abi, functionName, args, gas })
 */

import type { PublicClient, Address, Abi } from 'viem'

const FALLBACK_GAS = 800_000n
const BUFFER = 1.25 // 25% headroom

interface EstimateParams {
  address: Address
  abi: readonly unknown[]
  functionName: string
  args?: readonly unknown[]
  account: Address
  value?: bigint
}

export async function estimateGas(
  client: PublicClient,
  params: EstimateParams,
): Promise<bigint> {
  try {
    const estimated = await client.estimateContractGas(params as Parameters<typeof client.estimateContractGas>[0] & { abi: Abi })
    // Apply buffer, rounding up to the nearest 1000
    const buffered = BigInt(Math.ceil(Number(estimated) * BUFFER / 1000) * 1000)
    return buffered
  } catch {
    // Estimation failed — return a generous fallback so the tx can still be
    // submitted. The wallet will do its own estimation and may adjust further.
    return FALLBACK_GAS
  }
}
