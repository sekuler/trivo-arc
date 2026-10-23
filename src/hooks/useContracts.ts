import { useEffect } from 'react'
import { useAccount, useReadContract, useReadContracts } from 'wagmi'
import { erc20Abi } from 'viem'
import { BASKET_POOL_ABI, BASKET_ABI, getAddresses, TARGET_CHAIN_ID } from '../contracts'
import { useRefresh } from '../context/RefreshContext'

export function useAddresses() {
  const { chainId } = useAccount()
  return getAddresses(chainId ?? TARGET_CHAIN_ID)
}

export function useTokenBalances() {
  const { address } = useAccount()
  const addrs = useAddresses()
  const { refreshKey } = useRefresh()

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { address: addrs.USDC,   abi: erc20Abi, functionName: 'balanceOf', args: [address ?? '0x0000000000000000000000000000000000000000'] },
      { address: addrs.EURC,   abi: erc20Abi, functionName: 'balanceOf', args: [address ?? '0x0000000000000000000000000000000000000000'] },
      { address: addrs.CIRBTC, abi: erc20Abi, functionName: 'balanceOf', args: [address ?? '0x0000000000000000000000000000000000000000'] },
    ],
    query: { enabled: !!address, refetchInterval: 8000 },
  })

  // Re-fetch whenever a transaction completes anywhere in the app
  useEffect(() => {
    if (refreshKey > 0) void refetch()
  }, [refreshKey, refetch])

  return {
    usdc:   (data?.[0]?.result ?? 0n),
    eurc:   (data?.[1]?.result ?? 0n),
    cirBtc: (data?.[2]?.result ?? 0n),
    isLoading,
    refetch,
  }
}

export function usePoolReserves(poolAddress: `0x${string}`) {
  const { data, isLoading, refetch } = useReadContract({
    address: poolAddress,
    abi: BASKET_POOL_ABI,
    functionName: 'getReserves',
    query: { refetchInterval: 8000 },
  })
  const [r0, r1] = (data ?? [0n, 0n]) as [bigint, bigint]
  return { reserve0: r0, reserve1: r1, isLoading, refetch }
}

export function useBasketPosition() {
  const { address } = useAccount()
  const addrs = useAddresses()
  const { refreshKey } = useRefresh()

  const { data, isLoading, refetch } = useReadContract({
    address: addrs.BASKET,
    abi: BASKET_ABI,
    functionName: 'getBasketValue',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    query: { enabled: !!address, refetchInterval: 8000 },
  })

  useEffect(() => {
    if (refreshKey > 0) void refetch()
  }, [refreshKey, refetch])

  const [totalValue, usdcHeld, eurcHeld, btcHeld] = (data ?? [0n, 0n, 0n, 0n]) as [bigint, bigint, bigint, bigint]
  return { totalValue, usdcHeld, eurcHeld, btcHeld, isLoading, refetch }
}

export function useBasketAllocation() {
  const { address } = useAccount()
  const addrs = useAddresses()
  const { data, isLoading, refetch } = useReadContract({
    address: addrs.BASKET,
    abi: BASKET_ABI,
    functionName: 'getAllocation',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    query: { enabled: !!address, refetchInterval: 15000 },
  })
  const [usdcBps, eurcBps, btcBps] = (data ?? [4000n, 3000n, 3000n]) as [bigint, bigint, bigint]
  return { usdcBps: Number(usdcBps), eurcBps: Number(eurcBps), btcBps: Number(btcBps), isLoading, refetch }
}

export function usePoolLpBalance(poolAddress: `0x${string}`) {
  const { address } = useAccount()
  const { data, isLoading, refetch } = useReadContract({
    address: poolAddress,
    abi: BASKET_POOL_ABI,
    functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    query: { enabled: !!address, refetchInterval: 8000 },
  })
  return { lpBalance: (data ?? 0n) as bigint, isLoading, refetch }
}

export function usePoolTotalSupply(poolAddress: `0x${string}`) {
  const { data } = useReadContract({
    address: poolAddress,
    abi: BASKET_POOL_ABI,
    functionName: 'totalSupply',
    query: { refetchInterval: 8000 },
  })
  return (data ?? 0n) as bigint
}
