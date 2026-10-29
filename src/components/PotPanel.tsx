/* oxlint-disable set-state-in-effect -- refreshPot/refreshFee are async (void-wrapped); setState is never called synchronously inside the effect */
/**
 * PotPanel — Eco Sauce Pot setup + status panel.
 * Shows predicted Pot address, deploy/fund controls, balance, and withdraw.
 * Arc Mainnet only. All txs: eth_call simulate first, maxFeePerGas ≥ 20 gwei.
 */

import { useState, useEffect, useCallback } from 'react'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { encodeFunctionData, erc20Abi, hexToString, parseUnits, getAddress, type Hex, type WalletClient } from 'viem'
import { v12KitchenAbi } from '@eco-incorp/sauce/evm/engine'
import {
  KITCHEN, MIN_FEE_PER_GAS,
  DEFAULT_POT_SALT, kitchenExecutionFee, v12PredictPot,
  buildWithdrawCall, buildConditionalBuyCall,
  type CompiledPrograms,
} from '../hooks/useSauce'
import { TARGET_CHAIN_ID, MAINNET_ADDRESSES } from '../contracts'
import { usePoolReserves, useBasketAllocation } from '../hooks/useContracts'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUnits } from '../utils/format'
import { ExternalLink, CheckCircle, AlertCircle, Loader } from 'lucide-react'

const glass = {
  card:  { background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '24px' },
  inner: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: '14px' },
} as const

const MIN_FEE = MIN_FEE_PER_GAS
const USDC_ADDR = MAINNET_ADDRESSES.USDC

interface Props {
  compiled: CompiledPrograms | null
  sauceReady: boolean
  sauceError: string | null
  onPotFunded?: () => void
}

// Uniswap-V2 style quote (0.3% fee), same formula as the Basket deposit preview
function ammQuote(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n
  const fee = amountIn * 997n
  return (fee * reserveOut) / (reserveIn * 1000n + fee)
}

const BUY_SLIPPAGE_BPS = 100n // 1%

// Decode a revert reason from raw revert data
function decodeRevert(data: Hex | undefined): string {
  if (!data || data === '0x') return 'unknown revert'
  try {
    // Standard Error(string) selector: 0x08c379a0
    if (data.startsWith('0x08c379a0')) {
      const msg = hexToString(('0x' + data.slice(138)) as Hex)
      return msg.replace(/\0/g, '')
    }
    // Sauce revert: look for our own require() messages first
    const str = hexToString(data)
    for (const known of ['price above limit', 'BTC pool empty', 'pot is empty', 'INSUFFICIENT_OUTPUT_AMOUNT', 'slippage']) {
      if (str.includes(known)) return known
    }
    const printable = str.replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim()
    if (printable.length > 3) return printable.slice(0, 120)
    return `0x${data.slice(2, 20)}…`
  } catch {
    return `0x${data.slice(2, 20)}…`
  }
}

export function PotPanel({ compiled, sauceReady, sauceError, onPotFunded }: Props) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: TARGET_CHAIN_ID })
  const { data: rawWalletClient } = useWalletClient()
  // Cast to the base WalletClient type to avoid viem's narrow chain-typed overload
  const walletClient = rawWalletClient as WalletClient | undefined

  // Fee cap: network estimate, but never below Arc's 20 gwei minimum base fee
  const feeCap = async (): Promise<bigint> => {
    if (!publicClient) return MIN_FEE
    try {
      const est = await publicClient.estimateFeesPerGas()
      return est.maxFeePerGas > MIN_FEE ? est.maxFeePerGas : MIN_FEE
    } catch {
      return MIN_FEE
    }
  }

  // Pot state
  const [potAddress, setPotAddress] = useState<Hex | null>(null)
  const [potDeployed, setPotDeployed] = useState<boolean | null>(null)
  const [potUsdc, setPotUsdc] = useState<bigint>(0n)
  const [kitchenFee, setKitchenFee] = useState<bigint>(0n)

  // UI state
  const [deployStep, setDeployStep]     = useState<'idle' | 'simulating' | 'sending' | 'done'>('idle')
  const [fundAmount, setFundAmount]     = useState('1')
  const [fundStep, setFundStep]         = useState<'idle' | 'simulating' | 'sending' | 'done'>('idle')
  const [withdrawStep, setWithdrawStep] = useState<'idle' | 'simulating' | 'sending' | 'done'>('idle')
  const [deployHash, setDeployHash]     = useState<Hex | null>(null)
  const [fundHash, setFundHash]         = useState<Hex | null>(null)
  const [, setWithdrawHash] = useState<Hex | null>(null)
  const [error, setError]               = useState<string | null>(null)
  const [lastWithdrawTx, setLastWithdrawTx] = useState<Hex | null>(null)

  // Conditional buy state
  const [buyAmount, setBuyAmount]   = useState('0.5')
  const [maxPrice, setMaxPrice]     = useState('')
  const [buyStep, setBuyStep]       = useState<'idle' | 'simulating' | 'sending' | 'done'>('idle')
  const [lastBuyTx, setLastBuyTx]   = useState<Hex | null>(null)

  // Live pool data (cirBTC price + quotes for slippage floors)
  const { reserve0: eurcR0, reserve1: eurcR1 } = usePoolReserves(MAINNET_ADDRESSES.POOL_USDC_EURC)
  const { reserve0: btcR0,  reserve1: btcR1  } = usePoolReserves(MAINNET_ADDRESSES.POOL_USDC_BTC)
  const { eurcBps, btcBps } = useBasketAllocation()
  // USDC per whole cirBTC, 6 decimals — same formula the Sauce program checks onchain
  const btcPrice = btcR1 > 0n ? (btcR0 * 100_000_000n) / btcR1 : 0n

  let buyAmt = 0n
  try { buyAmt = buyAmount ? parseUnits(buyAmount, 6) : 0n } catch { buyAmt = 0n }
  let maxPriceRaw = 0n
  try { maxPriceRaw = maxPrice ? parseUnits(maxPrice, 6) : 0n } catch { maxPriceRaw = 0n }
  const minEurc = (ammQuote((buyAmt * BigInt(eurcBps)) / 10000n, eurcR0, eurcR1) * (10000n - BUY_SLIPPAGE_BPS)) / 10000n
  const minBtc  = (ammQuote((buyAmt * BigInt(btcBps))  / 10000n, btcR0,  btcR1)  * (10000n - BUY_SLIPPAGE_BPS)) / 10000n
  const conditionMet = btcPrice > 0n && maxPriceRaw > 0n && btcPrice <= maxPriceRaw

  // ── Derive & verify Pot ──────────────────────────────────────────────────────
  const refreshPot = useCallback(async () => {
    if (!address || !publicClient) return
    const pot = getAddress(v12PredictPot(getAddress(address), DEFAULT_POT_SALT))
    setPotAddress(pot)
    const code = await publicClient.getCode({ address: pot })
    const deployed = !!code && code !== '0x'
    setPotDeployed(deployed)
    if (deployed) {
      const bal = await publicClient.readContract({
        address: USDC_ADDR,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [pot],
        blockTag: 'latest',
      })
      setPotUsdc(bal)
    } else {
      setPotUsdc(0n)
    }
  }, [address, publicClient])

  // ── Read Kitchen fee ─────────────────────────────────────────────────────────
  const refreshFee = useCallback(async () => {
    if (!publicClient) return
    const req = kitchenExecutionFee()
    const { data } = await publicClient.call({ to: req.to, data: req.data })
    if (data) setKitchenFee(req.decode(data))
  }, [publicClient])

  useEffect(() => {
    if (!isConnected || !address) return
    void refreshPot()
    void refreshFee()
  }, [isConnected, address, refreshPot, refreshFee])

  // ── Deploy Pot ───────────────────────────────────────────────────────────────
  async function handleDeploy() {
    if (!address || !publicClient || !walletClient || !potAddress) return
    setError(null)
    setDeployStep('simulating')
    try {
      const data = encodeFunctionData({
        abi: v12KitchenAbi,
        functionName: 'deployPot',
        args: [getAddress(address), DEFAULT_POT_SALT],
      })
      // eth_call simulate
      try {
        await publicClient.call({ to: KITCHEN, data, account: address })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        // "already deployed" is fine — check for it
        if (!msg.includes('already') && !msg.includes('exists')) {
          const revertData = revertDataFrom(e) ?? extractRevertData(msg)
          setError('Simulate failed: ' + decodeRevert(revertData))
          setDeployStep('idle')
          return
        }
      }
      setDeployStep('sending')
      const deployTxHash: Hex = await walletClient.sendTransaction({
        account: address,
        to: KITCHEN,
        data,
        value: 0n,
        maxFeePerGas: await feeCap(),
        chain: null,
      })
      setDeployHash(deployTxHash)
      await publicClient.waitForTransactionReceipt({ hash: deployTxHash })
      // Re-verify eth_getCode at Pot address
      const code = await publicClient.getCode({ address: potAddress })
      if (!code || code === '0x') {
        setError('Pot not found onchain after deploy — check tx')
        setDeployStep('idle')
        return
      }
      setPotDeployed(true)
      setDeployStep('done')
      await refreshPot()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 200) : String(e))
      setDeployStep('idle')
    }
  }

  // ── Fund Pot ─────────────────────────────────────────────────────────────────
  async function handleFund() {
    if (!address || !publicClient || !walletClient || !potAddress || !potDeployed) return
    setError(null)
    const amt = parseUnits(fundAmount || '1', 6)
    if (amt <= 0n) return
    setFundStep('simulating')
    try {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [potAddress, amt],
      })
      // eth_call simulate
      try {
        await publicClient.call({ to: USDC_ADDR, data, account: address })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        const revertData = revertDataFrom(e) ?? extractRevertData(msg)
        setError('Simulate failed: ' + decodeRevert(revertData))
        setFundStep('idle')
        return
      }
      setFundStep('sending')
      const fundTxHash: Hex = await walletClient.sendTransaction({
        account: address,
        to: USDC_ADDR,
        data,
        value: 0n,
        maxFeePerGas: await feeCap(),
        chain: null,
      })
      setFundHash(fundTxHash)
      await publicClient.waitForTransactionReceipt({ hash: fundTxHash })
      setFundStep('done')
      await refreshPot()
      onPotFunded?.()
      setTimeout(() => setFundStep('idle'), 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 200) : String(e))
      setFundStep('idle')
    }
  }

  // ── Withdraw from Pot ────────────────────────────────────────────────────────
  // Cook tx shape: owner wallet → Pot.cook(engine, payload), value = Kitchen fee
  async function handleWithdraw() {
    if (!address || !publicClient || !walletClient || !potAddress || !compiled) return
    if (potUsdc === 0n) { setError('Pot has no USDC to withdraw'); return }
    setError(null)
    setWithdrawStep('simulating')
    try {
      // SDK builds the exact tx: to=Pot, data=cook(engine,payload), value=kitchenFee
      const cook = buildWithdrawCall(compiled, potAddress, kitchenFee, getAddress(address))

      // eth_call: account = connected owner wallet (the same address that sends the real tx)
      try {
        await publicClient.call({
          account: address,    // owner wallet
          to:      cook.to,    // Pot
          data:    cook.data,
          value:   cook.value, // Kitchen fee
        })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        const revertData = revertDataFrom(e) ?? extractRevertData(msg)
        setError('Simulate failed: ' + decodeRevert(revertData))
        setWithdrawStep('idle')
        return
      }
      setWithdrawStep('sending')
      const wdTxHash: Hex = await walletClient.sendTransaction({
        account:      address,     // owner wallet sends
        to:           cook.to,     // to the Pot
        data:         cook.data,
        value:        cook.value,  // Kitchen fee
        maxFeePerGas: await feeCap(),
        chain: null,
      })
      setWithdrawHash(wdTxHash)
      setLastWithdrawTx(wdTxHash)
      await publicClient.waitForTransactionReceipt({ hash: wdTxHash })
      setWithdrawStep('done')
      await refreshPot()
      setTimeout(() => setWithdrawStep('idle'), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 200) : String(e))
      setWithdrawStep('idle')
    }
  }

  // ── Conditional buy ───────────────────────────────────────────────────────────
  // Cook tx shape: owner wallet → Pot.cook(engine, payload), value = Kitchen fee
  async function handleConditionalBuy() {
    if (!address || !publicClient || !walletClient || !potAddress || !compiled) return
    if (potDeployed !== true) { setError('Deploy your Pot first'); return }
    if (buyAmt === 0n) { setError('Enter a USDC amount'); return }
    if (buyAmt > potUsdc) { setError('Not enough USDC in your Pot. Fund it first.'); return }
    if (maxPriceRaw === 0n) { setError('Enter a max cirBTC price'); return }
    setError(null)
    setBuyStep('simulating')
    try {
      const cook = buildConditionalBuyCall(
        compiled, potAddress, kitchenFee, getAddress(address),
        buyAmt, maxPriceRaw, minEurc, minBtc,
      )
      try {
        await publicClient.call({ account: address, to: cook.to, data: cook.data, value: cook.value })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        const reason = decodeRevert(revertDataFrom(e) ?? extractRevertData(msg))
        setError(reason.includes('price above limit')
          ? 'Not executed: cirBTC price is above your limit. Nothing was sent.'
          : 'Simulate failed: ' + reason)
        setBuyStep('idle')
        return
      }
      setBuyStep('sending')
      const buyTxHash: Hex = await walletClient.sendTransaction({
        account:      address,
        to:           cook.to,
        data:         cook.data,
        value:        cook.value,
        maxFeePerGas: await feeCap(),
        chain: null,
      })
      setLastBuyTx(buyTxHash)
      const receipt = await publicClient.waitForTransactionReceipt({ hash: buyTxHash })
      if (receipt.status !== 'success') {
        setError('Transaction reverted onchain. Nothing was deposited.')
        setBuyStep('idle')
        await refreshPot()
        return
      }
      setBuyStep('done')
      await refreshPot()
      onPotFunded?.()
      setTimeout(() => setBuyStep('idle'), 4000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 200) : String(e))
      setBuyStep('idle')
    }
  }

  if (!isConnected) return null

  const explorerBase = `https://explorer.arc.io`

  return (
    <div style={glass.card} className="p-5 mt-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--subtle)' }}>
          Eco Sauce Pot
        </span>
        {sauceReady
          ? <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--success)' }}>Ready</span>
          : <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--subtle)' }}>Loading…</span>
        }
      </div>

      {sauceError && (
        <div className="text-xs mb-3 p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}>
          Sauce compiler error: {sauceError}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-xs mb-3 p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* Pot address row */}
      <div style={glass.inner} className="px-4 py-3 mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>Your Pot</span>
          {potDeployed === true && <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--success)' }}><CheckCircle className="size-3" /> Deployed</span>}
          {potDeployed === false && <span className="text-xs" style={{ color: 'var(--muted)' }}>Not deployed</span>}
          {potDeployed === null && <Loader className="size-3 animate-spin" style={{ color: 'var(--subtle)' }} />}
        </div>
        {potAddress
          ? <a href={`${explorerBase}/address/${potAddress}`} target="_blank" rel="noreferrer"
               className="flex items-center gap-1 text-xs font-mono" style={{ color: 'var(--accent)' }}>
              {potAddress.slice(0, 10)}…{potAddress.slice(-8)} <ExternalLink className="size-3" />
            </a>
          : <span className="text-xs" style={{ color: 'var(--muted)' }}>Deriving…</span>
        }
      </div>

      {/* Deploy Pot */}
      {potDeployed === false && (
        <button
          onClick={() => { void handleDeploy() }}
          disabled={deployStep !== 'idle' || !sauceReady}
          className="w-full rounded-xl py-2.5 text-sm font-semibold mb-3 transition-opacity"
          style={{
            background: deployStep !== 'idle' ? 'rgba(255,255,255,0.08)' : 'var(--accent)',
            color: deployStep !== 'idle' ? 'var(--muted)' : '#fff',
            opacity: deployStep !== 'idle' ? 0.7 : 1,
          }}>
          {deployStep === 'idle'      && 'Deploy Pot'}
          {deployStep === 'simulating'&& 'Simulating…'}
          {deployStep === 'sending'   && 'Sending…'}
          {deployStep === 'done'      && '✓ Pot Deployed'}
        </button>
      )}
      {deployHash && (
        <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, deployHash)} target="_blank" rel="noreferrer"
           className="flex items-center gap-1 text-xs mb-3" style={{ color: 'var(--accent)' }}>
          Deploy tx <ExternalLink className="size-3" />
        </a>
      )}

      {/* Fund Pot */}
      {potDeployed === true && (
        <>
          <div style={glass.inner} className="px-4 py-3 mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>Pot USDC balance</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                {formatUnits(potUsdc, 6, 6)} USDC
              </span>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                value={fundAmount}
                onChange={e => setFundAmount(e.target.value)}
                min="0"
                step="0.1"
                placeholder="1"
                className="flex-1 rounded-lg px-3 py-1.5 text-sm"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--ink)', outline: 'none' }}
              />
              <button
                onClick={() => { void handleFund() }}
                disabled={fundStep !== 'idle' || !sauceReady}
                className="rounded-lg px-4 py-1.5 text-xs font-semibold transition-opacity"
                style={{
                  background: fundStep !== 'idle' ? 'rgba(255,255,255,0.08)' : 'var(--accent)',
                  color: fundStep !== 'idle' ? 'var(--muted)' : '#fff',
                  opacity: fundStep !== 'idle' ? 0.7 : 1,
                }}>
                {fundStep === 'idle'       && 'Fund Pot'}
                {fundStep === 'simulating' && 'Simulating…'}
                {fundStep === 'sending'    && 'Sending…'}
                {fundStep === 'done'       && '✓ Funded'}
              </button>
            </div>
            {fundHash && (
              <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, fundHash)} target="_blank" rel="noreferrer"
                 className="flex items-center gap-1 text-xs mt-2" style={{ color: 'var(--accent)' }}>
                Fund tx <ExternalLink className="size-3" />
              </a>
            )}
          </div>

          {/* Conditional buy */}
          <div style={glass.inner} className="px-4 py-3 mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium" style={{ color: 'var(--ink-2)' }}>Conditional buy</span>
              <span className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                cirBTC now: {btcPrice > 0n ? formatUnits(btcPrice, 6, 2) : '…'} USDC
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs" style={{ color: 'var(--subtle)' }}>
                USDC amount (from your Pot)
                <input
                  type="text" inputMode="decimal" value={buyAmount}
                  onChange={e => setBuyAmount(e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))}
                  placeholder="0.5"
                  className="w-full mt-1 rounded-lg px-3 py-1.5 text-sm"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--ink)', outline: 'none' }}
                />
              </label>
              <label className="text-xs" style={{ color: 'var(--subtle)' }}>
                Max cirBTC price (whole USDC, e.g. 81500)
                <input
                  type="text" inputMode="numeric" value={maxPrice}
                  onChange={e => setMaxPrice(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder={btcPrice > 0n ? formatUnits(btcPrice, 6, 0) : ''}
                  className="w-full mt-1 rounded-lg px-3 py-1.5 text-sm"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--ink)', outline: 'none' }}
                />
              </label>
              {maxPriceRaw > 0n && btcPrice > 0n && (
                <span className="text-xs" style={{ color: conditionMet ? 'var(--success)' : 'var(--subtle)' }}>
                  {conditionMet ? 'Condition met at the current price.' : 'Price is above your limit. The buy will not execute.'}
                </span>
              )}
              <button
                onClick={() => { void handleConditionalBuy() }}
                disabled={buyStep !== 'idle' || !sauceReady || !compiled || potDeployed !== true || buyAmt === 0n || buyAmt > potUsdc || maxPriceRaw === 0n}
                className="w-full rounded-lg py-2 text-xs font-semibold transition-opacity"
                style={{
                  background: buyStep !== 'idle' ? 'rgba(255,255,255,0.08)' : 'var(--accent)',
                  color: buyStep !== 'idle' ? 'var(--muted)' : '#fff',
                  opacity: (buyStep !== 'idle' || buyAmt === 0n || buyAmt > potUsdc || maxPriceRaw === 0n) ? 0.6 : 1,
                }}>
                {buyStep === 'idle'       && (buyAmt > potUsdc ? 'Fund your Pot first' : 'Buy basket if price ≤ limit')}
                {buyStep === 'simulating' && 'Checking price…'}
                {buyStep === 'sending'    && 'Sending cook…'}
                {buyStep === 'done'       && '✓ Basket bought'}
              </button>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                Executes only if the cirBTC price is at or below your limit. Powered by Eco Sauce.
              </span>
              {lastBuyTx && (
                <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, lastBuyTx)} target="_blank" rel="noreferrer"
                   className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
                  Buy tx <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          </div>

          {/* Withdraw from Pot */}
          {potUsdc > 0n && (
            <button
              onClick={() => { void handleWithdraw() }}
              disabled={withdrawStep !== 'idle' || !sauceReady || !compiled}
              className="w-full rounded-xl py-2.5 text-sm font-semibold transition-opacity"
              style={{
                background: withdrawStep !== 'idle' ? 'rgba(255,255,255,0.08)' : 'rgba(239,68,68,0.18)',
                color: withdrawStep !== 'idle' ? 'var(--muted)' : 'var(--danger)',
                border: '1px solid rgba(239,68,68,0.25)',
                opacity: withdrawStep !== 'idle' ? 0.7 : 1,
              }}>
              {withdrawStep === 'idle'       && `Withdraw ${formatUnits(potUsdc, 6, 6)} USDC from Pot`}
              {withdrawStep === 'simulating' && 'Simulating…'}
              {withdrawStep === 'sending'    && 'Sending cook…'}
              {withdrawStep === 'done'       && '✓ Withdrawn'}
            </button>
          )}
          {lastWithdrawTx && (
            <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, lastWithdrawTx)} target="_blank" rel="noreferrer"
               className="flex items-center gap-1 text-xs mt-2" style={{ color: 'var(--accent)' }}>
              Withdraw tx <ExternalLink className="size-3" />
            </a>
          )}
        </>
      )}

      <p className="text-xs mt-4" style={{ color: 'var(--muted)' }}>
        Powered by{' '}
        <a href="https://eco.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Eco Sauce</a>.
        Your Pot is a smart contract that holds USDC and executes the conditional buy program atomically.
      </p>
    </div>
  )
}

// Extract hex revert data from a viem error message
function extractRevertData(msg: string): Hex | undefined {
  // Prefer an explicit "data: 0x…" field; never grab an address or calldata by accident
  const m = msg.match(/(?:revert data|data)[:=\s"]+(0x[0-9a-fA-F]{8,})/i)
  return m ? (m[1] as Hex) : undefined
}

// Walk the viem error chain and return the raw revert data, if the RPC sent it
function revertDataFrom(e: unknown): Hex | undefined {
  let cur: unknown = e
  for (let i = 0; i < 10 && cur && typeof cur === 'object'; i++) {
    const o = cur as { data?: unknown; cause?: unknown }
    if (typeof o.data === 'string' && /^0x[0-9a-fA-F]*$/.test(o.data) && o.data.length > 2) return o.data as Hex
    if (o.data && typeof o.data === 'object') {
      const inner = (o.data as { data?: unknown }).data
      if (typeof inner === 'string' && /^0x[0-9a-fA-F]*$/.test(inner) && inner.length > 2) return inner as Hex
    }
    cur = o.cause
  }
  return undefined
}
