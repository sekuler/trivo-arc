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
  buildWithdrawCall, buildConditionalBuyCall, useSauce,
  type CompiledPrograms,
} from '../hooks/useSauce'
import { useRefresh } from '../context/RefreshContext'
import { TARGET_CHAIN_ID, MAINNET_ADDRESSES } from '../contracts'
import { usePoolReserves, useBasketAllocation } from '../hooks/useContracts'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { formatUnits } from '../utils/format'
import { ExternalLink, AlertCircle, Loader } from 'lucide-react'

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
  const [showFund, setShowFund]     = useState(false)

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

  const explorerBase = `https://explorer.arc.io`
  const priceWhole = btcPrice / 1_000_000n
  const inputStyle = { color: 'var(--ink)' } as const
  const linkBtn = 'text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-40'
  const buyDisabled = buyStep !== 'idle' || !sauceReady || !compiled || potDeployed !== true || buyAmt === 0n || buyAmt > potUsdc || maxPriceRaw === 0n

  return (
    <div className="space-y-4">
      <div style={glass.card} className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>Limit Buy</h3>
          <span className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
            cirBTC now: <span style={{ color: 'var(--ink)' }}>{btcPrice > 0n ? priceWhole.toLocaleString('en-US') : '…'}</span> USDC
          </span>
        </div>

        {!isConnected && (
          <p className="text-sm py-6 text-center" style={{ color: 'var(--subtle)' }}>Connect your wallet to use Limit Buy.</p>
        )}

        {isConnected && sauceError && (
          <div className="text-xs mb-3 p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}>
            Sauce compiler error: {sauceError}
          </div>
        )}

        {isConnected && error && (
          <div className="flex items-start gap-2 text-xs mb-3 p-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {/* One-time setup */}
        {isConnected && potDeployed === null && (
          <div className="flex justify-center py-6"><Loader className="size-4 animate-spin" style={{ color: 'var(--subtle)' }} /></div>
        )}
        {isConnected && potDeployed === false && (
          <>
            <p className="text-sm mb-4" style={{ color: 'var(--subtle)' }}>
              Buy the basket only when cirBTC is at or below your price. First, create your Pot: a small onchain account owned by your wallet that holds the USDC for your limit buys.
            </p>
            <button
              onClick={() => { void handleDeploy() }}
              disabled={deployStep !== 'idle' || !sauceReady}
              className="w-full py-3.5 rounded-2xl text-sm font-bold transition-opacity disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#0d1b2f' }}>
              {deployStep === 'idle'       && 'Create your Pot'}
              {deployStep === 'simulating' && 'Checking…'}
              {deployStep === 'sending'    && 'Creating…'}
              {deployStep === 'done'       && '✓ Pot created'}
            </button>
          </>
        )}

        {/* Limit buy form */}
        {isConnected && potDeployed === true && (
          <>
            {/* Amount */}
            <div style={glass.inner} className="p-4 mb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs" style={{ color: 'var(--subtle)' }}>You spend (USDC)</span>
                <button onClick={() => setBuyAmount(formatUnits(potUsdc, 6, 6))} disabled={potUsdc === 0n}
                  className={linkBtn} style={{ color: 'var(--accent)' }}>
                  Pot: {formatUnits(potUsdc, 6, 6)} Max
                </button>
              </div>
              <input
                inputMode="decimal" value={buyAmount}
                onChange={e => setBuyAmount(e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))}
                placeholder="0.00"
                className="display w-full bg-transparent text-3xl font-bold tabular-nums outline-none placeholder:opacity-20"
                style={inputStyle} />
            </div>

            {/* Max price */}
            <div style={glass.inner} className="p-4 mb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs" style={{ color: 'var(--subtle)' }}>Buy only if cirBTC ≤ (USDC)</span>
                <button onClick={() => setMaxPrice(String(priceWhole))} disabled={btcPrice === 0n}
                  className={linkBtn} style={{ color: 'var(--accent)' }}>
                  Use current
                </button>
              </div>
              <input
                inputMode="numeric" value={maxPrice}
                onChange={e => setMaxPrice(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder={btcPrice > 0n ? String(priceWhole) : '0'}
                className="display w-full bg-transparent text-3xl font-bold tabular-nums outline-none placeholder:opacity-20"
                style={inputStyle} />
              {maxPriceRaw > 0n && btcPrice > 0n && (
                <div className="text-xs mt-2" style={{ color: conditionMet ? 'var(--success)' : 'var(--subtle)' }}>
                  {conditionMet ? '✓ Condition met at the current price.' : 'Price is above your limit. The buy will not execute.'}
                </div>
              )}
            </div>

            {/* Buy */}
            <button
              onClick={() => { void handleConditionalBuy() }}
              disabled={buyDisabled}
              className="w-full py-3.5 rounded-2xl text-sm font-bold transition-opacity disabled:opacity-40"
              style={{ background: 'var(--accent)', color: '#0d1b2f' }}>
              {buyStep === 'idle'       && (buyAmt > potUsdc ? 'Add funds to your Pot first' : 'Buy basket')}
              {buyStep === 'simulating' && 'Checking price…'}
              {buyStep === 'sending'    && 'Buying…'}
              {buyStep === 'done'       && '✓ Basket bought'}
            </button>
            {lastBuyTx && (
              <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, lastBuyTx)} target="_blank" rel="noreferrer"
                 className="flex items-center justify-center gap-1 text-xs mt-2" style={{ color: 'var(--accent)' }}>
                View buy transaction <ExternalLink className="size-3" />
              </a>
            )}

            {/* Pot footer */}
            <div className="mt-4 pt-3 flex items-center justify-between gap-2 text-xs" style={{ borderTop: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--subtle)' }}>
                Pot{' '}
                {potAddress && (
                  <a href={`${explorerBase}/address/${potAddress}`} target="_blank" rel="noreferrer"
                     className="font-mono" style={{ color: 'var(--accent)' }}>
                    {potAddress.slice(0, 6)}…{potAddress.slice(-4)}
                  </a>
                )}
                {' · '}<span className="tabular-nums" style={{ color: 'var(--ink)' }}>{formatUnits(potUsdc, 6, 6)} USDC</span>
              </span>
              <span className="flex items-center gap-3">
                <button onClick={() => setShowFund(v => !v)} className={linkBtn} style={{ color: 'var(--accent)' }}>
                  Add funds
                </button>
                <button onClick={() => { void handleWithdraw() }}
                  disabled={withdrawStep !== 'idle' || potUsdc === 0n || !compiled}
                  className={linkBtn} style={{ color: 'var(--danger)' }}>
                  {withdrawStep === 'idle' ? 'Withdraw' : withdrawStep === 'done' ? '✓ Withdrawn' : 'Withdrawing…'}
                </button>
              </span>
            </div>

            {showFund && (
              <div className="flex gap-2 mt-3">
                <input
                  inputMode="decimal" value={fundAmount}
                  onChange={e => setFundAmount(e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))}
                  placeholder="USDC"
                  className="flex-1 rounded-xl px-3 py-2 text-sm bg-transparent outline-none tabular-nums"
                  style={{ border: '1px solid var(--border)', color: 'var(--ink)' }} />
                <button onClick={() => { void handleFund() }}
                  disabled={fundStep !== 'idle' || !sauceReady}
                  className="rounded-xl px-4 py-2 text-xs font-bold transition-opacity disabled:opacity-40"
                  style={{ background: 'var(--accent)', color: '#0d1b2f' }}>
                  {fundStep === 'idle' ? 'Add to Pot' : fundStep === 'done' ? '✓ Added' : 'Adding…'}
                </button>
              </div>
            )}

            {(fundHash || lastWithdrawTx) && (
              <div className="flex gap-3 mt-2">
                {fundHash && (
                  <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, fundHash)} target="_blank" rel="noreferrer"
                     className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
                    Funding tx <ExternalLink className="size-3" />
                  </a>
                )}
                {lastWithdrawTx && (
                  <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, lastWithdrawTx)} target="_blank" rel="noreferrer"
                     className="flex items-center gap-1 text-xs" style={{ color: 'var(--accent)' }}>
                    Withdraw tx <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            )}
          </>
        )}

        {deployHash && potDeployed !== true && (
          <a href={buildTxExplorerUrl(TARGET_CHAIN_ID, deployHash)} target="_blank" rel="noreferrer"
             className="flex items-center gap-1 text-xs mt-2" style={{ color: 'var(--accent)' }}>
            Pot creation tx <ExternalLink className="size-3" />
          </a>
        )}

        <p className="text-xs mt-4" style={{ color: 'var(--muted)' }}>
          Executes only if the cirBTC price is at or below your limit. Powered by{' '}
          <a href="https://eco.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Eco Sauce</a>.
        </p>
      </div>
    </div>
  )
}

// Limit Buy tab: loads the Sauce compiler and renders the panel
export function LimitBuyTab() {
  const { compiled, sauceReady, sauceError } = useSauce()
  const { triggerRefresh } = useRefresh()
  return (
    <PotPanel
      compiled={compiled}
      sauceReady={sauceReady}
      sauceError={sauceError}
      onPotFunded={() => triggerRefresh()}
    />
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
